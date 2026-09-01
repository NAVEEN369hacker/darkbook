/**
 * ImageUploader — file picker + thumbnail preview + remove button.
 * Used by Feed composer and Admin composer.
 */

import { useRef, useState } from 'react';

type Props = {
  onChange: (file: File | null) => void;
  disabled?: boolean;
};

export default function ImageUploader({ onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFile = (file: File | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    if (!file) {
      setPreviewUrl(null);
      onChange(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    onChange(file);
  };

  return (
    <div className="image-uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0] || null)}
        disabled={disabled}
        id="image-uploader-input"
      />
      {previewUrl ? (
        <div className="image-uploader-preview">
          <img src={previewUrl} alt="preview" />
          <button
            type="button"
            className="image-uploader-remove"
            onClick={() => {
              handleFile(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            disabled={disabled}
            id="image-uploader-remove"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="image-uploader-pick"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          id="image-uploader-pick"
        >
          <span style={{ fontSize: 18 }}>📷</span>
          <span>Add photo</span>
        </button>
      )}
    </div>
  );
}