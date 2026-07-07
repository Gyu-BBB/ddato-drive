const DB_NAME = "ddato-drive-upload-queue";
const DB_VERSION = 1;
const STORE_NAME = "uploads";
const ACCOUNT_INDEX = "accountId";

export async function getStoredUploads(accountId) {
  if (!accountId) return [];
  return withStore("readonly", (store) => requestToPromise(store.index(ACCOUNT_INDEX).getAll(accountId)));
}

export async function saveStoredUpload(item) {
  await withStore("readwrite", (store) => requestToPromise(store.put(item)));
  return item;
}

export async function updateStoredUpload(id, patch) {
  return withStore("readwrite", async (store) => {
    const current = await requestToPromise(store.get(id));
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await requestToPromise(store.put(next));
    return next;
  });
}

export async function removeStoredUpload(id) {
  await withStore("readwrite", (store) => requestToPromise(store.delete(id)));
}

function openUploadDb() {
  return new Promise((resolve, reject) => {
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("업로드 저장소를 열지 못했습니다."));
  });
}

function withStore(mode, action) {
  return new Promise((resolve, reject) => {
    openUploadDb().then((database) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let actionResult;

      transaction.oncomplete = () => {
        database.close();
        resolve(actionResult);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("업로드 저장소 작업에 실패했습니다."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("업로드 저장소 작업이 중단되었습니다."));
      };

      Promise.resolve(action(store)).then((result) => {
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
