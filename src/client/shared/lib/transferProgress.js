export function createSpeedMeter(now = () => performance.now()) {
  let time = now();
  let bytes = 0;
  let speed = 0;
  return (loaded) => {
    const current = now();
    const elapsed = current - time;
    if (elapsed >= 250) {
      speed = Math.max(0, (loaded - bytes) * 1000 / elapsed);
      time = current;
      bytes = loaded;
    }
    return speed;
  };
}
