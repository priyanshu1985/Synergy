import { useRef, useState } from 'react';

export default function PhotoSOSModal({ isOpen, onClose, onPhotoRecorded }) {
  const [stage, setStage] = useState('select'); // 'select' | 'compressing' | 'preview' | 'error'
  const [originalSizeMb, setOriginalSizeMb] = useState(0);
  const [compressedSizeKb, setCompressedSizeKb] = useState(0);
  const [reductionPercent, setReductionPercent] = useState(0);
  const [compressedB64, setCompressedB64] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const processImageFile = (file) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (JPEG, PNG, WebP).');
      setStage('error');
      return;
    }

    setStage('compressing');
    setErrorMsg('');

    const origMb = (file.size / (1024 * 1024)).toFixed(2);
    setOriginalSizeMb(origMb);

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;

      img.onload = () => {
        // Client-side HTML5 Canvas low-bandwidth compression pipeline
        const canvas = document.createElement('canvas');
        const MAX_DIM = 1024; // Max 1024px dimension maintains detail while dropping payload size

        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Attempt WebP at 0.65 quality, fallback to JPEG
        let b64 = canvas.toDataURL('image/webp', 0.65);
        if (!b64 || b64.startsWith('data:image/png')) {
          b64 = canvas.toDataURL('image/jpeg', 0.65);
        }

        // Calculate compressed size in KB
        const approxBytes = b64.length * 0.75;
        const compKb = (approxBytes / 1024).toFixed(1);
        setCompressedSizeKb(compKb);

        const origKb = file.size / 1024;
        const reduction = Math.max(0, Math.round((1 - approxBytes / origKb) * 100));
        setReductionPercent(reduction);

        setCompressedB64(b64);
        setPreviewUrl(b64);
        setStage('preview');
      };

      img.onerror = () => {
        setErrorMsg('Could not read or decode image file.');
        setStage('error');
      };
    };

    reader.onerror = () => {
      setErrorMsg('Failed to read image file from storage.');
      setStage('error');
    };
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleApplyPhotoSOS = () => {
    if (onPhotoRecorded && compressedB64) {
      onPhotoRecorded({
        imageData: compressedB64,
        originalSizeMb,
        compressedSizeKb,
        reductionPercent
      });
    }
    onClose();
  };

  const resetModal = () => {
    setStage('select');
    setCompressedB64(null);
    setPreviewUrl(null);
    setErrorMsg('');
  };

  if (!isOpen) return null;

  return (
    <div className="photo-sos-modal-overlay">
      <div className="photo-sos-modal-content">
        <div className="modal-header">
          <h3>📷 Attach Disaster Photo</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Hidden File Inputs */}
        <input
          type="file"
          ref={cameraInputRef}
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={galleryInputRef}
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {stage === 'error' && (
          <div className="photo-modal-body">
            <div className="voice-error-box">
              <div className="error-icon">⚠️</div>
              <p className="error-text">{errorMsg}</p>
              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button className="voice-btn secondary" onClick={resetModal}>Try Again</button>
                <button className="voice-btn danger" onClick={onClose}>Close</button>
              </div>
            </div>
          </div>
        )}

        {stage === 'select' && (
          <div className="photo-modal-body select-body">
            <p className="modal-subtitle">
              Capture or select a photo of the flood situation. Your image will be compressed automatically for fast emergency transmission.
            </p>

            <div className="photo-choice-grid">
              <button
                type="button"
                className="photo-choice-btn primary"
                onClick={() => cameraInputRef.current?.click()}
              >
                <span className="choice-icon">📷</span>
                <span className="choice-title">Capture Photo</span>
                <span className="choice-desc">Use device camera</span>
              </button>

              <button
                type="button"
                className="photo-choice-btn secondary"
                onClick={() => galleryInputRef.current?.click()}
              >
                <span className="choice-icon">🖼️</span>
                <span className="choice-title">Choose from Gallery</span>
                <span className="choice-desc">Select existing photo</span>
              </button>
            </div>
          </div>
        )}

        {stage === 'compressing' && (
          <div className="photo-modal-body compressing-body">
            <div className="compressing-spinner"></div>
            <h4>Compressing Image for Emergency Upload...</h4>
            <p className="compress-sub">Optimizing resolution for 2G / 3G low signal...</p>
          </div>
        )}

        {stage === 'preview' && (
          <div className="photo-modal-body preview-body">
            {/* Image Preview & Compression Badge */}
            <div className="image-preview-container">
              <img src={previewUrl} alt="Disaster SOS Capture" className="photo-preview-img" />
              <div className="compression-meta-pill">
                Original: <b>{originalSizeMb} MB</b> ↓ Compressed: <b>{compressedSizeKb} KB</b> ({reductionPercent}% smaller)
              </div>
            </div>

            <div className="modal-actions-grid">
              <button type="button" className="voice-btn secondary" onClick={resetModal}>
                🔄 Choose Another
              </button>
              <button type="button" className="voice-btn success" onClick={handleApplyPhotoSOS}>
                ✅ Attach Photo to SOS
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
