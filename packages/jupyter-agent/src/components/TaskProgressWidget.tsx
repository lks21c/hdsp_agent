/**
 * Task Progress Widget Component
 * Floating widget showing notebook generation progress
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Box,
  IconButton,
  Collapse,
  Chip,
  Button,
  Tooltip
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CancelIcon from '@mui/icons-material/Cancel';
import { ITaskStatus } from '../types';

interface TaskProgressWidgetProps {
  taskStatus: ITaskStatus;
  onClose: () => void;
  onCancel: () => void;
  onOpenNotebook: () => void;
}

export const TaskProgressWidget: React.FC<TaskProgressWidgetProps> = ({
  taskStatus,
  onClose,
  onCancel,
  onOpenNotebook
}) => {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const { status, progress, message, prompt, error, notebookPath } = taskStatus;

  const isComplete = status === 'completed';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const isRunning = status === 'running';
  const isDone = isComplete || isFailed || isCancelled;

  // Get status color
  const getStatusColor = () => {
    if (isComplete) return 'success';
    if (isFailed) return 'error';
    if (isCancelled) return 'default';
    return 'primary';
  };

  // Get status icon
  const getStatusIcon = () => {
    if (isComplete) return <CheckCircleIcon fontSize="small" />;
    if (isFailed) return <ErrorIcon fontSize="small" />;
    if (isCancelled) return <CancelIcon fontSize="small" />;
    return null;
  };

  // Get status text
  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return '대기 중';
      case 'running':
        return '생성 중';
      case 'completed':
        return '완료';
      case 'failed':
        return '실패';
      case 'cancelled':
        return '취소됨';
      default:
        return status;
    }
  };

  return (
    <Card
      sx={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: expanded ? 380 : 320,
        maxWidth: '90vw',
        boxShadow: 3,
        zIndex: 1300,
        transition: 'all 0.3s ease'
      }}
    >
      <CardContent sx={{ padding: 2, '&:last-child': { paddingBottom: 2 } }}>
        {/* Header */}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="subtitle2" fontWeight="bold">
              노트북 생성
            </Typography>
            <Chip
              label={getStatusText()}
              size="small"
              color={getStatusColor() as any}
              icon={getStatusIcon() || undefined}
            />
          </Box>

          <Box display="flex">
            <IconButton
              size="small"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? (
                <ExpandLessIcon fontSize="small" />
              ) : (
                <ExpandMoreIcon fontSize="small" />
              )}
            </IconButton>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Progress */}
        {!isDone && (
          <Box mb={2}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{ height: 6, borderRadius: 1 }}
            />
            <Box display="flex" justifyContent="space-between" mt={0.5}>
              <Typography variant="caption" color="text.secondary">
                {message}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {progress}%
              </Typography>
            </Box>
          </Box>
        )}

        {/* Completed message */}
        {isComplete && (
          <Box mb={2}>
            <Typography variant="body2" color="success.main">
              ✓ {message}
            </Typography>
          </Box>
        )}

        {/* Error message */}
        {isFailed && error && (
          <Box mb={2}>
            <Typography variant="body2" color="error.main">
              ✗ {error}
            </Typography>
          </Box>
        )}

        {/* Details */}
        <Collapse in={showDetails}>
          <Box
            sx={{
              backgroundColor: 'action.hover',
              borderRadius: 1,
              padding: 1.5,
              mb: 2
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              mb={0.5}
            >
              프롬프트:
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {prompt}
            </Typography>

            {notebookPath && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  mt={1}
                  mb={0.5}
                >
                  저장 위치:
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}
                >
                  {notebookPath}
                </Typography>
              </>
            )}
          </Box>
        </Collapse>

        {/* Actions */}
        <Box display="flex" gap={1} justifyContent="flex-end">
          {isRunning && (
            <Button size="small" variant="outlined" onClick={onCancel}>
              취소
            </Button>
          )}

          {isComplete && notebookPath && (
            <Button
              size="small"
              variant="contained"
              onClick={onOpenNotebook}
            >
              노트북 열기
            </Button>
          )}

          {isDone && (
            <Button size="small" variant="text" onClick={onClose}>
              닫기
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};
