/**
 * File Selection Dialog Component
 *
 * Shows multiple file options to user when a filename is ambiguous
 */

import React from 'react';

interface FileOption {
  path: string;
  relative: string;
  dir: string;
}

interface FileSelectionDialogProps {
  filename: string;
  options: FileOption[];
  message: string;
  onSelect: (index: number) => void;
  onCancel: () => void;
}

export const FileSelectionDialog: React.FC<FileSelectionDialogProps> = ({
  filename,
  options,
  message,
  onSelect,
  onCancel
}) => {
  return (
    <div className="file-selection-dialog">
      <div className="file-selection-overlay" onClick={onCancel} />
      <div className="file-selection-content">
        <h3>파일 선택</h3>
        <p className="file-selection-message">{message}</p>

        <div className="file-selection-options">
          {options.map((option, idx) => (
            <button
              key={idx}
              className="file-option-button"
              onClick={() => onSelect(idx + 1)}
            >
              <span className="file-option-number">{idx + 1}</span>
              <span className="file-option-path">{option.relative}</span>
            </button>
          ))}
        </div>

        <div className="file-selection-actions">
          <button className="file-selection-cancel" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>

      <style>{`
        .file-selection-dialog {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .file-selection-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
        }

        .file-selection-content {
          position: relative;
          background: var(--jp-layout-color1);
          border: 1px solid var(--jp-border-color1);
          border-radius: 8px;
          padding: 24px;
          max-width: 600px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .file-selection-content h3 {
          margin: 0 0 12px 0;
          color: var(--jp-ui-font-color1);
          font-size: 18px;
          font-weight: 600;
        }

        .file-selection-message {
          margin: 0 0 20px 0;
          color: var(--jp-ui-font-color2);
          font-size: 14px;
          white-space: pre-wrap;
          line-height: 1.6;
        }

        .file-selection-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 20px;
        }

        .file-option-button {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--jp-layout-color2);
          border: 1px solid var(--jp-border-color2);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }

        .file-option-button:hover {
          background: var(--jp-layout-color3);
          border-color: var(--jp-brand-color1);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .file-option-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: var(--jp-brand-color1);
          color: white;
          border-radius: 50%;
          font-weight: 600;
          font-size: 14px;
          flex-shrink: 0;
        }

        .file-option-path {
          flex: 1;
          color: var(--jp-ui-font-color1);
          font-family: var(--jp-code-font-family);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-selection-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .file-selection-cancel {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid var(--jp-border-color2);
          border-radius: 4px;
          color: var(--jp-ui-font-color1);
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .file-selection-cancel:hover {
          background: var(--jp-layout-color2);
          border-color: var(--jp-border-color1);
        }
      `}</style>
    </div>
  );
};