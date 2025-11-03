/**
 * Prompt Generation Dialog Component
 * Dialog for entering prompts to generate notebooks
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Box,
  Chip
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

interface PromptGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}

const EXAMPLE_PROMPTS = [
  '타이타닉 생존자 예측을 dask와 lgbm으로 생성해줘',
  '주식 데이터 분석 및 시각화 노트북 만들어줘',
  'Iris 데이터셋으로 분류 모델 학습하기',
  '시계열 데이터 분석 및 예측 모델 만들기'
];

export const PromptGenerationDialog: React.FC<PromptGenerationDialogProps> = ({
  open,
  onClose,
  onGenerate
}) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  const handleGenerate = () => {
    if (prompt.trim()) {
      setIsGenerating(true);
      onGenerate(prompt.trim());
      setPrompt('');
      setIsGenerating(false);
      onClose();
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      handleGenerate();
    }
  };

  const handleExampleClick = (example: string) => {
    setPrompt(example);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          minHeight: '400px'
        }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <AutoFixHighIcon color="primary" />
          <Typography variant="h6">HDSP 프롬프트로 노트북 생성</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            원하는 노트북의 내용을 자연어로 설명해주세요. AI가 자동으로 노트북을
            생성합니다.
          </Typography>

          <TextField
            autoFocus
            multiline
            rows={6}
            fullWidth
            variant="outlined"
            placeholder="예: 타이타닉 생존자 예측을 dask와 lgbm으로 생성해줘"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isGenerating}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '14px'
              }
            }}
          />

          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              mb={1}
            >
              예시 프롬프트 (클릭하여 사용):
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {EXAMPLE_PROMPTS.map((example, index) => (
                <Chip
                  key={index}
                  label={example}
                  variant="outlined"
                  size="small"
                  onClick={() => handleExampleClick(example)}
                  sx={{
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                />
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              backgroundColor: 'action.hover',
              borderRadius: 1,
              padding: 2
            }}
          >
            <Typography variant="caption" color="text.secondary">
              💡 <strong>팁:</strong>
              <br />
              • 사용할 라이브러리를 명시하면 더 정확합니다
              <br />
              • 분석 목적과 데이터를 구체적으로 설명하세요
              <br />
              • Ctrl + Enter로 빠르게 생성할 수 있습니다
              <br />• 생성은 백그라운드에서 진행되며, 완료되면 알림을
              받습니다
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ padding: 2, paddingTop: 0 }}>
        <Button onClick={onClose} disabled={isGenerating}>
          취소
        </Button>
        <Button
          onClick={handleGenerate}
          variant="contained"
          disabled={!prompt.trim() || isGenerating}
          startIcon={<AutoFixHighIcon />}
        >
          생성 시작
        </Button>
      </DialogActions>
    </Dialog>
  );
};
