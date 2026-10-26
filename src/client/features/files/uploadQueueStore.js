const DB_NAME = "ddato-drive-upload-queue";
const DB_VERSION = 2;
const STORE_NAME = "uploads";
const FILE_STORE_NAME = "uploadFiles";
const ACCOUNT_INDEX = "accountId";
let connection = null;

export async function getStoredUploads(accountId) {
  if (!accountId) return [];
  return withStore("readonly", async (store, files) => {
    const items = await requestToPromise(store.index(ACCOUNT_INDEX).getAll(accountId));
    return Promise.all(items.map(async item => ({ ...item, file: (await requestToPromise(files.get(item.id)))?.file || item.file || null })));
  });
}

export async function saveStoredUpload(item) {
  await withStore("readwrite", async (store, files) => {
    const { file, ...metadata } = item;
    if (file && item.persistenceMode !== 'reselect' && !(await requestToPromise(files.getKey(item.id)))) {
      await requestToPromise(files.put({ id: item.id, file }));
    }
    if (item.persistenceMode === 'reselect') await requestToPromise(files.delete(item.id));
    await requestToPromise(store.put(metadata));
  });
  return item;
}

export async function updateStoredUpload(id, patch) {
  return withStore("readwrite", async (store) => {
    const current = await requestToPromise(store.get(id));
    if (!current) return null;
    const { file, ...metadataPatch } = patch;
    const next = { ...current, ...metadataPatch, updatedAt: Date.now() };
    await requestToPromise(store.put(next));
    return next;
  });
}

export async function removeStoredUpload(id) {
  await withStore("readwrite", (store, files) => Promise.all([
    requestToPromise(store.delete(id)), requestToPromise(files.delete(id))
  ]));
}

function openUploadDb() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("이 브라우저는 백그라운드 업로드 저장소를 지원하지 않습니다."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });

      if (!store.indexNames.contains(ACCOUNT_INDEX)) {
        store.createIndex(ACCOUNT_INDEX, ACCOUNT_INDEX, { unique: false });
      }
      const files = database.objectStoreNames.contains(FILE_STORE_NAME)
        ? request.transaction.objectStore(FILE_STORE_NAME)
        : database.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const { file, ...metadata } = cursor.value;
        if (file) files.put({ id: metadata.id, file });
        cursor.update(metadata);
        cursor.continue();
      };
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); connection = null; };
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error("업로드 저장소를 열지 못했습니다."));
  });
  connection.catch(() => { connection = null; });
  return connection;
}

function withStore(mode, action) {
  return new Promise((resolve, reject) => {
    openUploadDb().then((database) => {
      const transaction = database.transaction([STORE_NAME, FILE_STORE_NAME], mode);
      const store = transaction.objectStore(STORE_NAME);
      const files = transaction.objectStore(FILE_STORE_NAME);
      let actionResult;

      transaction.oncomplete = () => {
        resolve(actionResult);
      };
      transaction.onerror = () => {
        reject(transaction.error || new Error("업로드 저장소 작업에 실패했습니다."));
      };
      transaction.onabort = () => {
        reject(transaction.error || new Error("업로드 저장소 작업이 중단되었습니다."));
      };

      Promise.resolve(action(store, files)).then((result) => {
        actionResult = result;
      }, (error) => {
        transaction.abort();
        reject(error);
      });
    }, reject);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("업로드 저장소 요청에 실패했습니다."));
  });
}
