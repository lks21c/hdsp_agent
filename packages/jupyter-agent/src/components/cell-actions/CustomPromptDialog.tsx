/**
 * Custom Prompt Dialog Component
 * Modal dialog for entering custom prompts for cells
 */

import React, { useState, useCallback, KeyboardEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Paper
} from '@mui/material';

export interface ICustomPromptDialogProps {
  isOpen: boolean;
  cellContent: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export const CustomPromptDialog: React.FC<ICustomPromptDialogProps> = ({
  isOpen,
  cellContent,
  onSubmit,
  onCancel
}) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = useCallback(() => {
    if (prompt.trim()) {
      onSubmit(prompt);
      setPrompt('');
    }
  }, [prompt, onSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }, [handleSubmit, onCancel]);

  const handleCancel = useCallback(() => {
    setPrompt('');
    onCancel();
  }, [onCancel]);

  // Truncate cell content for preview
  const cellPreview = cellContent.length > 200
    ? cellContent.substring(0, 200) + '...'
    : cellContent;

  return (
    <Dialog
      open={isOpen}
      onClose={handleCancel}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Custom Prompt for Cell</DialogTitle>

      <DialogContent>
        <Box mb={2}>
          <Typography variant="caption" color="textSecondary">
            Cell Content Preview:
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1,
              mt: 1,
              maxHeight: 100,
              overflow: 'auto',
              backgroundColor: 'background.default'
            }}
          >
            <code style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
              {cellPreview}
            </code>
          </Paper>
        </Box>

        <TextField
          autoFocus
          fullWidth
          multiline
          rows={4}
          label="Enter your prompt"
          placeholder="e.g., 'Add docstrings to this function' or 'Optimize this code for performance'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          helperText="Press Enter to submit, Shift+Enter for new line, Escape to cancel"
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!prompt.trim()}
        >
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};
