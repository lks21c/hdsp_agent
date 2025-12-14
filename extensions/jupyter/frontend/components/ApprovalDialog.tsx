/**
 * ApprovalDialog - 위험 도구 실행 승인 다이얼로그
 *
 * 높은 위험 수준의 도구 실행 전 사용자 확인을 받는 UI
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  Alert,
  LinearProgress,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SecurityIcon from '@mui/icons-material/Security';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

import { ApprovalRequest, ToolRiskLevel } from '../types/auto-agent';

interface ApprovalDialogProps {
  open: boolean;
  request: ApprovalRequest | null;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string, reason?: string) => void;
  onClose: () => void;
  /** 자동 거부 타임아웃 (초). 0이면 비활성화 */
  autoRejectTimeout?: number;
}

/**
 * 위험 수준별 색상 및 아이콘
 */
const RISK_LEVEL_CONFIG: Record<ToolRiskLevel, {
  color: 'success' | 'warning' | 'error' | 'info';
  emoji: string;
  label: string;
  severity: 'success' | 'warning' | 'error' | 'info';
}> = {
  low: {
    color: 'success',
    emoji: '🟢',
    label: '낮음',
    severity: 'success',
  },
  medium: {
    color: 'info',
    emoji: '🟡',
    label: '보통',
    severity: 'info',
  },
  high: {
    color: 'warning',
    emoji: '🟠',
    label: '높음',
    severity: 'warning',
  },
  critical: {
    color: 'error',
    emoji: '🔴',
    label: '위험',
    severity: 'error',
  },
};

/**
 * 카테고리별 한글 레이블
 */
const CATEGORY_LABELS: Record<string, string> = {
  cell: '셀 작업',
  file: '파일 시스템',
  network: '네트워크',
  system: '시스템 명령',
  answer: '응답',
};

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  open,
  request,
  onApprove,
  onReject,
  onClose,
  autoRejectTimeout = 0,
}) => {
  const [rejectReason, setRejectReason] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(autoRejectTimeout);

  // 자동 거부 타이머
  React.useEffect(() => {
    if (!open || !request || autoRejectTimeout <= 0) {
      return;
    }

    setTimeRemaining(autoRejectTimeout);

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onReject(request.id, '자동 타임아웃');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [open, request, autoRejectTimeout, onReject]);

  if (!request) {
    return null;
  }

  const { toolDefinition, parameters, stepNumber, description } = request;
  const riskConfig = RISK_LEVEL_CONFIG[toolDefinition.riskLevel];

  const handleApprove = () => {
    onApprove(request.id);
    onClose();
  };

  const handleReject = () => {
    onReject(request.id, rejectReason || undefined);
    onClose();
  };

  // 파라미터 요약 생성
  const formatParameters = () => {
    if (!parameters) return null;

    return Object.entries(parameters).map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'string') {
        displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
      } else {
        displayValue = JSON.stringify(value, null, 2);
        if (displayValue.length > 100) {
          displayValue = displayValue.substring(0, 100) + '...';
        }
      }

      return (
        <Box key={key} sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {key}:
          </Typography>
          <Typography
            variant="body2"
            component="pre"
            sx={{
              fontFamily: 'monospace',
              fontSize: '12px',
              backgroundColor: 'action.hover',
              padding: 1,
              borderRadius: 1,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            {displayValue}
          </Typography>
        </Box>
      );
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onReject(request.id, '사용자 취소');
        onClose();
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          border: `2px solid`,
          borderColor: `${riskConfig.color}.main`,
        },
      }}
    >
      {/* 자동 타임아웃 프로그레스 바 */}
      {autoRejectTimeout > 0 && (
        <LinearProgress
          variant="determinate"
          value={(timeRemaining / autoRejectTimeout) * 100}
          color={riskConfig.color}
          sx={{ height: 4 }}
        />
      )}

      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          {toolDefinition.riskLevel === 'critical' || toolDefinition.riskLevel === 'high' ? (
            <WarningAmberIcon color={riskConfig.color} />
          ) : (
            <SecurityIcon color={riskConfig.color} />
          )}
          <Typography variant="h6">도구 실행 승인 요청</Typography>
          {autoRejectTimeout > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {timeRemaining}초 후 자동 거부
            </Typography>
          )}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2}>
          {/* 경고 메시지 */}
          <Alert severity={riskConfig.severity} icon={false}>
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="body2">
                {riskConfig.emoji} <strong>{toolDefinition.name}</strong> 도구 실행을 요청합니다.
              </Typography>
            </Box>
          </Alert>

          {/* 도구 정보 */}
          <Box>
            <Box display="flex" gap={1} mb={1}>
              <Chip
                label={`위험 수준: ${riskConfig.label}`}
                color={riskConfig.color}
                size="small"
              />
              <Chip
                label={CATEGORY_LABELS[toolDefinition.category] || toolDefinition.category}
                variant="outlined"
                size="small"
              />
              {stepNumber !== undefined && (
                <Chip
                  label={`Step ${stepNumber}`}
                  variant="outlined"
                  size="small"
                />
              )}
            </Box>

            <Typography variant="body2" color="text.secondary">
              {toolDefinition.description}
            </Typography>
          </Box>

          {/* 설명 */}
          {description && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                설명:
              </Typography>
              <Typography variant="body2">{description}</Typography>
            </Box>
          )}

          {/* 파라미터 */}
          {parameters && Object.keys(parameters).length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                파라미터:
              </Typography>
              {formatParameters()}
            </Box>
          )}

          {/* 주의 사항 */}
          {(toolDefinition.riskLevel === 'high' || toolDefinition.riskLevel === 'critical') && (
            <Alert severity="warning">
              <Typography variant="caption">
                <strong>주의:</strong> 이 작업은 시스템에 영향을 미칠 수 있습니다.
                실행 전 파라미터를 확인하세요.
              </Typography>
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ padding: 2, gap: 1 }}>
        <Button
          onClick={handleReject}
          color="error"
          variant="outlined"
          startIcon={<CancelIcon />}
        >
          거부
        </Button>
        <Button
          onClick={handleApprove}
          color="primary"
          variant="contained"
          startIcon={<CheckCircleIcon />}
          autoFocus
        >
          승인
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ApprovalDialog;
