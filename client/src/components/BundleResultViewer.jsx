import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Tabs,
  Tab,
  Typography,
  Paper,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'react';
import useContentProtection from '../hooks/useContentProtection';
import renderMathInElement from '../utils/renderMathInElement';

import {
  Article,
  MenuBook,
  Quiz,
  Close,
  CheckCircle,
  Publish,
  Download,
  OpenInFull,
  CloseFullscreen,
} from '@mui/icons-material';

/**
 * TabPanel component
 */
function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`bundle-tabpanel-${index}`}
      aria-labelledby={`bundle-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

/**
 * BundleResultViewer - Displays generated Teacher Note, Learner Note, and Quiz
 */
function BundleResultViewer({
  open,
  onClose,
  bundleData,
  onPublish,
  onDownloadItem,
  isDownloadingItem = false,
  fullScreen = false,
  onToggleFullscreen,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const { protectionProps, protectionSx } = useContentProtection({ enabled: open });
  const lessonNoteRef = useRef(null);
  const learnerNoteRef = useRef(null);

  const { lessonNote, learnerNote, quiz } = bundleData || {};
  const sanitizedLessonNoteContent = useMemo(
    () => DOMPurify.sanitize(lessonNote?.content || ''),
    [lessonNote?.content]
  );
  const sanitizedLearnerNoteContent = useMemo(
    () => DOMPurify.sanitize(learnerNote?.content || ''),
    [learnerNote?.content]
  );

  useEffect(() => {
    renderMathInElement(lessonNoteRef.current);
  }, [sanitizedLessonNoteContent, open, activeTab]);

  useEffect(() => {
    renderMathInElement(learnerNoteRef.current);
  }, [sanitizedLearnerNoteContent, open, activeTab]);

  if (!bundleData) return null;

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const handlePublish = () => {
    if (onPublish) {
      onPublish(bundleData);
    }
  };

  const buildQuizHtml = () => {
    const section = (title, items, lineBuilder) => {
      if (!Array.isArray(items) || items.length === 0) return '';
      return `
        <h3>${title}</h3>
        <ol>
          ${items.map(lineBuilder).join('')}
        </ol>
      `;
    };

    return `
      <h2>${quiz?.title || 'Quiz'}</h2>
      ${section('Multiple Choice Questions', quiz?.mcq, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <ul>${(q.options || []).map((opt, idx) => `<li>${String.fromCharCode(65 + idx)}. ${opt}${idx === q.correctIndex ? ' (Correct)' : ''}</li>`).join('')}</ul>
        </li>
      `)}
      ${section('True or False', quiz?.trueFalse, (q) => `
        <li>
          <p><strong>${q.statement || ''}</strong></p>
          <p>Answer: ${q.answer ? 'True' : 'False'}</p>
        </li>
      `)}
      ${section('Short Answer', quiz?.shortAnswer, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <p>Expected Answer: ${q.expectedAnswer || ''}</p>
        </li>
      `)}
      ${section('Essay', quiz?.essay, (q) => `
        <li>
          <p><strong>${q.question || ''}</strong></p>
          <p>Marking Guide: ${q.markingGuide || ''}</p>
        </li>
      `)}
    `;
  };

  const handleDownload = (itemType) => {
    if (!onDownloadItem) return;

    if (itemType === 'lesson_note') {
      onDownloadItem({
        itemType,
        itemId: lessonNote?.id || lessonNote?._id,
        title: lessonNote?.subStrand || 'teacher-lesson-note',
        htmlContent: sanitizedLessonNoteContent,
      });
      return;
    }

    if (itemType === 'learner_note') {
      onDownloadItem({
        itemType,
        itemId: learnerNote?.id || learnerNote?._id,
        title: learnerNote?.subStrand || 'learner-note',
        htmlContent: sanitizedLearnerNoteContent,
      });
      return;
    }

    onDownloadItem({
      itemType: 'quiz',
      itemId: quiz?.id || quiz?._id,
      title: quiz?.title || 'quiz',
      htmlContent: buildQuizHtml(),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} scroll="paper" fullWidth maxWidth={fullScreen ? false : 'lg'}>
      {/* Header */}
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CheckCircle color="success" sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Lesson Bundle Generated Successfully!
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Review your AI-generated content below
              </Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1}>
            {onToggleFullscreen && (
              <Tooltip title={fullScreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                <IconButton aria-label={fullScreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={onToggleFullscreen}>
                  {fullScreen ? <CloseFullscreen /> : <OpenInFull />}
                </IconButton>
              </Tooltip>
            )}
            <IconButton aria-label="Close dialog" onClick={onClose}>
              <Close />
            </IconButton>
          </Stack>
        </Box>
      </DialogTitle>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab
            icon={<Article />}
            label="Teacher Lesson Note"
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 64 }}
          />
          <Tab
            icon={<MenuBook />}
            label="Learner Note"
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 64 }}
          />
          <Tab
            icon={<Quiz />}
            label={`Quiz (${quiz?.totalQuestions || 0} Questions)`}
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 64 }}
          />
        </Tabs>
      </Box>

      {/* Content */}
      <DialogContent
        tabIndex={0}
        {...protectionProps}
        sx={{ position: 'relative', bgcolor: 'grey.50', overflowY: 'auto', ...protectionSx }}
      >

        {/* Tab 1: Teacher Note */}
        <TabPanel value={activeTab} index={0}>
          <Paper elevation={0} sx={{ p: 4, maxWidth: 1000, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                disabled={isDownloadingItem}
                onClick={() => handleDownload('lesson_note')}
              >
                {isDownloadingItem ? 'Processing...' : 'Pay GHC 0.5 & Download'}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              Topic: {lessonNote?.subStrand}
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Box
              ref={lessonNoteRef}
              dangerouslySetInnerHTML={{ __html: sanitizedLessonNoteContent }}
              sx={{
                '& h2': { fontSize: '1.5rem', fontWeight: 600, mt: 3, mb: 2 },
                '& h3': { fontSize: '1.25rem', fontWeight: 600, mt: 2, mb: 1 },
                '& table': {
                  width: '100%',
                  borderCollapse: 'collapse',
                  my: 2,
                  '& td, & th': {
                    border: '1px solid #ddd',
                    padding: '12px',
                  },
                  '& th': {
                    backgroundColor: '#f5f5f5',
                    fontWeight: 600,
                  },
                },
                '& p': { lineHeight: 1.7, mb: 1 },
                '& ul, & ol': { pl: 3, mb: 2 },
              }}
            />
          </Paper>
        </TabPanel>

        {/* Tab 2: Learner Note */}
        <TabPanel value={activeTab} index={1}>
          <Paper elevation={0} sx={{ p: 4, maxWidth: 900, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                disabled={isDownloadingItem}
                onClick={() => handleDownload('learner_note')}
              >
                {isDownloadingItem ? 'Processing...' : 'Pay GHC 0.5 & Download'}
              </Button>
            </Box>
            <Alert severity="info" sx={{ mb: 3 }}>
              <strong>Status:</strong> {learnerNote?.status === 'draft' ? 'Draft' : 'Published'} 
              {learnerNote?.status === 'draft' && ' - Review and publish to make available to students'}
            </Alert>
            <Box
              ref={learnerNoteRef}
              dangerouslySetInnerHTML={{ __html: sanitizedLearnerNoteContent }}
              sx={{
                '& h1': { fontSize: '1.85rem', fontWeight: 700, mt: 1, mb: 2, color: 'text.primary' },
                '& h2': { fontSize: '1.45rem', fontWeight: 700, mt: 3, mb: 1.5, color: 'primary.main' },
                '& h3': { fontSize: '1.25rem', fontWeight: 600, mt: 2, mb: 1 },
                '& table': {
                  width: '100%',
                  borderCollapse: 'collapse',
                  my: 2,
                  bgcolor: '#fff',
                  '& td, & th': {
                    border: '1px solid #d8dee9',
                    padding: '10px 12px',
                    verticalAlign: 'top',
                  },
                  '& th': {
                    bgcolor: '#edf2ff',
                    color: '#243b7a',
                    fontWeight: 700,
                  },
                },
                '& p': { lineHeight: 1.8, mb: 2, fontSize: '1.05rem' },
                '& ul, & ol': { pl: 3, mb: 2, lineHeight: 1.8 },
                '& li': { mb: 1 },
                '& em': { color: 'text.secondary', fontSize: '0.95rem' },
                '& section': {
                  border: '1px solid #e6eaf2',
                  borderRadius: 2,
                  p: 2,
                  my: 2,
                  bgcolor: '#fcfdff',
                },
                '& figure': { my: 2, mx: 0 },
                '& figure img, & img': {
                  display: 'block',
                  width: '100%',
                  maxHeight: 360,
                  objectFit: 'cover',
                  borderRadius: 2,
                  border: '1px solid #d8dee9',
                  backgroundColor: '#f6f8fb',
                },
                '& figcaption': {
                  mt: 1,
                  fontSize: '0.88rem',
                  color: 'text.secondary',
                  fontStyle: 'italic',
                  textAlign: 'center',
                },
                '& hr': { border: 0, borderTop: '1px solid #e4e7ee', my: 2.5 },
              }}
            />
          </Paper>
        </TabPanel>

        {/* Tab 3: Quiz */}
        <TabPanel value={activeTab} index={2}>
          <Paper elevation={0} sx={{ p: 4, maxWidth: 1000, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download />}
                disabled={isDownloadingItem}
                onClick={() => handleDownload('quiz')}
              >
                {isDownloadingItem ? 'Processing...' : 'Pay GHC 0.5 & Download'}
              </Button>
            </Box>
            <Typography variant="h5" gutterBottom fontWeight={600}>
              {quiz?.title}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
              <Chip label={`${quiz?.breakdown?.mcq || 0} MCQ`} color="primary" size="small" />
              <Chip label={`${quiz?.breakdown?.trueFalse || 0} True/False`} color="secondary" size="small" />
              <Chip label={`${quiz?.breakdown?.shortAnswer || 0} Short Answer`} color="success" size="small" />
              <Chip label={`${quiz?.breakdown?.essay || 0} Essay`} color="warning" size="small" />
            </Stack>

            {/* MCQ Section */}
            {quiz?.mcq && quiz.mcq.length > 0 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label="MCQ" color="primary" size="small" />
                  Multiple Choice Questions ({quiz.mcq.length})
                </Typography>
                <List>
                  {quiz.mcq.map((q, idx) => (
                    <ListItem key={idx} sx={{ display: 'block', mb: 2, bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                      <Typography variant="body1" fontWeight={600} gutterBottom>
                        {idx + 1}. {q.question}
                      </Typography>
                      <Box sx={{ pl: 2 }}>
                        {q.options.map((opt, optIdx) => (
                          <Typography
                            key={optIdx}
                            variant="body2"
                            sx={{
                              color: optIdx === q.correctIndex ? 'success.main' : 'text.primary',
                              fontWeight: optIdx === q.correctIndex ? 600 : 400,
                              py: 0.5,
                            }}
                          >
                            {String.fromCharCode(65 + optIdx)}. {opt}
                            {optIdx === q.correctIndex && ' ✓'}
                          </Typography>
                        ))}
                      </Box>
                      {q.explanation && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, pl: 2 }}>
                          <strong>Explanation:</strong> {q.explanation}
                        </Typography>
                      )}
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* True/False Section */}
            {quiz?.trueFalse && quiz.trueFalse.length > 0 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label="T/F" color="secondary" size="small" />
                  True or False ({quiz.trueFalse.length})
                </Typography>
                <List>
                  {quiz.trueFalse.map((q, idx) => (
                    <ListItem key={idx} sx={{ display: 'block', mb: 2, bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                      <Typography variant="body1" fontWeight={600} gutterBottom>
                        {idx + 1}. {q.statement}
                      </Typography>
                      <Typography variant="body2" color="success.main" fontWeight={600}>
                        Answer: {q.answer ? 'True' : 'False'} ✓
                      </Typography>
                      {q.explanation && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          <strong>Explanation:</strong> {q.explanation}
                        </Typography>
                      )}
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* Short Answer Section */}
            {quiz?.shortAnswer && quiz.shortAnswer.length > 0 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label="Short Answer" color="success" size="small" />
                  Short Answer Questions ({quiz.shortAnswer.length})
                </Typography>
                <List>
                  {quiz.shortAnswer.map((q, idx) => (
                    <ListItem key={idx} sx={{ display: 'block', mb: 2, bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                      <Typography variant="body1" fontWeight={600} gutterBottom>
                        {idx + 1}. {q.question}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Expected Answer:</strong> {q.expectedAnswer}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* Essay Section */}
            {quiz?.essay && quiz.essay.length > 0 && (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label="Essay" color="warning" size="small" />
                  Essay Questions ({quiz.essay.length})
                </Typography>
                <List>
                  {quiz.essay.map((q, idx) => (
                    <ListItem key={idx} sx={{ display: 'block', mb: 2, bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                      <Typography variant="body1" fontWeight={600} gutterBottom>
                        {idx + 1}. {q.question}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>Marking Guide:</strong> {q.markingGuide}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Paper>
        </TabPanel>
      </DialogContent>

      {/* Actions */}
      <DialogActions sx={{ p: 3, gap: 1, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
        <Button
          variant="contained"
          startIcon={<Publish />}
          onClick={handlePublish}
          sx={{ minWidth: 200 }}
        >
          Publish to Students
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default BundleResultViewer;