// Member 3: QR offer / answer and cross-browser camera scanner.
import QRCode from 'qrcode';
import jsQR from 'jsqr';

export async function renderQR(canvas, token) {
  await QRCode.toCanvas(canvas, token, {width: 300, margin: 2, errorCorrectionLevel: 'L'});
}

export async function scanQR(video, onFound) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS and camera permission');
  const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}});
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  let active = true;
  let id;
  function cleanup() {
    active = false;
    if (id) cancelAnimationFrame(id);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
  function frame() {
    if (!active) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, canvas.width, canvas.height, {inversionAttempts: 'dontInvert'});
      if (result?.data.startsWith('MINIMOL1:')) {
        cleanup();
        onFound(result.data);
        return;
      }
    }
    id = requestAnimationFrame(frame);
  }
  id = requestAnimationFrame(frame);
  return cleanup;
}
