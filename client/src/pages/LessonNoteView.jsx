import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';

import {
  Box,
  Container,
  Paper,
  Typography,
  Stack,
  Button,
  CircularProgress,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { motion } from 'framer-motion';

// Redux thunks
import {
  getLessonNoteById,
  deleteLessonNote,
} from '../features/teacher/teacherSlice';

// Export helpers
import { downloadAsPdf, downloadAsWord } from '../utils/downloadHelper';

// Optional: render generated diagram images
import AiImage from '../components/AiImage';

/* ✅ ADDED: PDF-only view */
import LessonNotePdfView from '../components/LessonNotePdfView';
import renderMathInElement from '../utils/renderMathInElement';

const LessonNoteView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { currentNote, isLoading, isError, message } = useSelector(
    (s) => s.teacher
  );

  useEffect(() => {
    if (id) dispatch(getLessonNoteById(id));
  }, [dispatch, id]);

  const elementId = useMemo(() => `lesson-note-${id}`, [id]);
  const noteContentRef = useRef(null);

  /* ✅ ADDED: PDF element ID */
  const pdfElementId = useMemo(() => `pdf-lesson-note-${id}`, [id]);

  const handleDownload = useCallback(
    (type) => {
      if (!currentNote) return;
      const topic =
        currentNote?.title ||
        currentNote?.subStrand?.name ||
        'lesson_note';

      /* ✅ MODIFIED: PDF now uses PDF-only view */
      if (type === 'pdf') {
        downloadAsPdf(pdfElementId, topic, {});
      }
      if (type === 'word') downloadAsWord(elementId, topic);
    },
    [currentNote, elementId, pdfElementId]
  );

  const handleDelete = useCallback(async () => {
    if (!id) return;
    const ok = window.confirm(
      'Delete this lesson note? This action is irreversible.'
    );
    if (!ok) return;
    const res = await dispatch(deleteLessonNote(id));
    if (!res.error) navigate('/teacher/dashboard');
  }, [dispatch, id, navigate]);

  useEffect(() => {
    renderMathInElement(noteContentRef.current);
  }, [currentNote?.content]);

  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#4F6678',
        }}
      >
        <Box textAlign="center">
          <CircularProgress size={60} sx={{ color: 'white' }} />
          <Typography mt={2} color="white">
            Loading lesson note…
          </Typography>
        </Box>
      </Box>
    );
  }

  if (isError) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#4F6678',
        }}
      >
        <Box textAlign="center">
          <Typography color="white" variant="h6" mb={2}>
            Failed to load lesson note: {message}
          </Typography>
          <Button
            variant="contained"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/teacher/dashboard')}
          >
            Back to Dashboard
          </Button>
        </Box>
      </Box>
    );
  }

  if (!currentNote) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#4F6678',
        }}
      >
        <Box textAlign="center">
          <Typography color="white" variant="h6" mb={2}>
            Lesson note not found.
          </Typography>
          <Button
            variant="contained"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/teacher/dashboard')}
          >
            Back to Dashboard
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: '#4F6678',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          mb={3}
        >
          <Button
            variant="contained"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/teacher/dashboard')}
            sx={{
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
            }}
          >
            Back to Dashboard
          </Button>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<PictureAsPdfIcon />}
              onClick={() => handleDownload('pdf')}
              sx={{ background: 'white' }}
            >
              Export PDF
            </Button>

            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DescriptionIcon />}
              onClick={() => handleDownload('word')}
              sx={{ background: 'white' }}
            >
              Export Word
            </Button>

            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={handleDelete}
              sx={{ background: 'white' }}
            >
              Delete
            </Button>
          </Stack>
        </Stack>

        <Paper
          elevation={4}
          sx={{
            p: 4,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.95)',
          }}
          component={motion.div}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            {currentNote.title ||
              `Lesson Note for ${currentNote.subStrand?.name || 'Topic'}`}
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            mb={3}
          >
            Created on{' '}
            {new Date(currentNote.createdAt).toLocaleDateString()}
          </Typography>

          <Box id={elementId} ref={noteContentRef}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                p: ({ node, ...props }) => {
                  const text = node?.children?.[0]?.value || '';
                  if (
                    typeof text === 'string' &&
                    text.startsWith('[DIAGRAM:')
                  ) {
                    return <AiImage text={text} />;
                  }
                  return <p {...props} />;
                },
              }}
            >
              {currentNote.content || ''}
            </ReactMarkdown>
          </Box>
        </Paper>

        {/* ✅ ADDED: Hidden PDF-only renderer */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <LessonNotePdfView
            note={currentNote}
            elementId={pdfElementId}
          />
        </div>
      </Container>
    </Box>
  );
};

export default LessonNoteView;
