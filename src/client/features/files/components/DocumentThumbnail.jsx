import { useEffect, useRef, useState } from 'react';

const queue = [];
let active = 0;

function drain() {
  while (active < 2 && queue.length) {
    active += 1;
    queue.shift()();
  }
}

function schedule(file, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = queue.indexOf(run);
      if (index !== -1) queue.splice(index, 1);
      reject(signal.reason);
    };
    const run = async () => {
      try {
        signal.throwIfAborted();
        const { renderDocumentThumbnail } = await import('../documentThumbnails.js');
        signal.throwIfAborted();
        resolve(await renderDocumentThumbnail(file, signal));
      } catch (error) { reject(error); }
      finally {
        signal.removeEventListener('abort', abort);
        active -= 1;
        drain();
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    queue.push(run);
    drain();
  });
}

export function DocumentThumbnail({ file, fallback, size }) {
  const ref = useRef(null);
  const [image, setImage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      timer = setTimeout(() => controller.abort(), 45000);
      schedule(file, controller.signal).then(result => {
        if (!controller.signal.aborted) setImage(result);
      }).catch(() => {}).finally(() => clearTimeout(timer));
    }, { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => { observer.disconnect(); clearTimeout(timer); controller.abort(); };
  }, [file.id, file.updatedAt]);
  return <span ref={ref} className="media-thumbnail document-thumbnail" style={{ width: size, height: size }} aria-hidden="true">
    {image ? <img src={image} alt="" draggable={false} decoding="async" /> : fallback}
  </span>;
}
