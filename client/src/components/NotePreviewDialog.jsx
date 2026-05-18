/**
 * Note preview dialog with image rendering and download menu.
 * Extracted from TeacherDashboard.
 */
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Menu,
  MenuItem,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Download,
  ExpandMore,
} from '@mui/icons-material';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';
import DialogFullscreenTitle from './DialogFullscreenTitle';
import useContentProtection from '../hooks/useContentProtection';
import renderMathInElement from '../utils/renderMathInElement';


const contentSx = {
  '& h1': { fontSize: '1.8rem', fontWeight: 700, mt: 2, mb: 2 },
  '& h2': { fontSize: '1.5rem', fontWeight: 600, mt: 3, mb: 2 },
  '& h3': { fontSize: '1.25rem', fontWeight: 600, mt: 2, mb: 1 },
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    my: 2,
    '& td, & th': { border: '1px solid #ddd', padding: '12px' },
    '& th': { backgroundColor: '#f5f5f5', fontWeight: 600 },
  },
  '& p': { lineHeight: 1.7, mb: 1 },
  '& ul, & ol': { pl: 3, mb: 2 },
  '& section': { border: '1px solid #eceff3', borderRadius: 2, p: 2, my: 2 },
  '& figure': { my: 2, mx: 0 },
  '& img': {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
    borderRadius: 8,
    border: '1px solid #d8dee9',
  },
  '& figcaption': { mt: 1, fontSize: '0.86rem', color: 'text.secondary', textAlign: 'center' },
};

const compactContentSx = {
  '& *': { boxSizing: 'border-box' },
  '& h1': { fontSize: '1.4rem', fontWeight: 700, mt: 0.42, mb: 0.32 },
  '& h2': { fontSize: '1.2rem', fontWeight: 600, mt: 0.42, mb: 0.28 },
  '& h3': { fontSize: '1.05rem', fontWeight: 600, mt: 0.32, mb: 0.2 },
  '& table': {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    my: 0.3,
    fontSize: '0.93rem',
    '& td, & th': {
      border: '1px solid #ddd',
      padding: '3px 6px',
      verticalAlign: 'top',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
    '& th': { backgroundColor: '#f5f5f5', fontWeight: 600 },
  },
  '& p': { lineHeight: 1.22, mb: 0.2, fontSize: '0.96rem', wordBreak: 'break-word', overflowWrap: 'anywhere' },
  '& li': { wordBreak: 'break-word', overflowWrap: 'anywhere', marginBottom: '1px', fontSize: '0.96rem', lineHeight: 1.22 },
  '& ul, & ol': { pl: 1.6, mb: 0.24, mt: 0.1 },
  '& section': { border: '1px solid #eceff3', borderRadius: 1, p: 0.4, my: 0.28 },
  '& figure': { pageBreakInside: 'avoid', breakInside: 'avoid', my: 0.3 },
  '& > :first-child': { marginTop: '0 !important', paddingTop: 0 },
};

export default function NotePreviewDialog({
  open,
  onClose,
  note,
  segments = [],
  contentId,
  downloadMenuAnchorEl,
  onOpenDownloadMenu,
  onCloseDownloadMenu,
  onDownload,
  isPdfExporting = false,
  isChargingDownload = false,
  fullScreen = false,
  onToggleFullscreen,
  title = 'Preview Lesson Note',
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const effectiveFullScreen = fullScreen || isMobile;
  const { protectionProps, protectionSx } = useContentProtection({ enabled: open });
  const contentRef = useRef(null);
  const sanitizedSegments = useMemo(
    () => segments.map((segment) => (
      segment.type === 'text'
        ? { ...segment, safeHtml: DOMPurify.sanitize(segment.html || '') }
        : segment
    )),
    [segments]
  );

  useEffect(() => {
    renderMathInElement(contentRef.current);
  }, [sanitizedSegments, open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={effectiveFullScreen}
      scroll="paper"
      fullWidth
      maxWidth={effectiveFullScreen ? false : 'md'}
    >
      <DialogFullscreenTitle
        title={title}
        isFullscreen={fullScreen}
        onToggle={onToggleFullscreen}
      />
      <DialogContent
        tabIndex={0}
        {...protectionProps}
        sx={{
          position: 'relative',
          bgcolor: 'grey.50',
          overflowY: 'auto',
          px: { xs: 1, sm: 2.5 },
          py: { xs: 1, sm: 2 },
          ...protectionSx,
        }}
      >

        <Paper
          id={contentId}
          elevation={0}
          sx={{
            p: isPdfExporting ? 0.2 : { xs: 1.25, sm: 4 },
            width: isPdfExporting ? '920px' : '100%',
            maxWidth: isPdfExporting ? 'none' : 1000,
            mx: 'auto',
            overflowX: { xs: 'auto', sm: 'visible' },
          }}
        >
          <Box ref={contentRef} sx={isPdfExporting ? compactContentSx : contentSx}>
            {sanitizedSegments.map((seg, idx) => {
              if (seg.type === 'text') {
                return <Box key={idx} dangerouslySetInnerHTML={{ __html: seg.safeHtml }} />;
              }
              if (seg.type === 'image') {
                if (seg.imgUrl === undefined) {
                  return (
                    <Typography key={idx} variant="caption" color="text.secondary">
                      Loading image...
                    </Typography>
                  );
                }
                if (!seg.imgUrl) return null;
                return (
                  <Box key={idx} sx={{ my: 2, textAlign: 'center' }}>
                    <img
                      src={seg.imgUrl}
                      alt={seg.meta?.title || ''}
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                    {seg.meta?.title && (
                      <Typography variant="caption" display="block">
                        {seg.meta.title}
                      </Typography>
                    )}
                  </Box>
                );
              }
              return null;
            })}
          </Box>
        </Paper>
      </DialogContent>
      <DialogActions>
        <Button
          variant="outlined"
          startIcon={<Download />}
          endIcon={<ExpandMore />}
          onClick={onOpenDownloadMenu}
          disabled={!note || isPdfExporting || isChargingDownload}
        >
          {isChargingDownload ? 'Processing payment...' : 'Download (GHC 0.5 per option)'}
        </Button>
        <Menu
          anchorEl={downloadMenuAnchorEl}
          open={Boolean(downloadMenuAnchorEl)}
          onClose={onCloseDownloadMenu}
        >
          <MenuItem onClick={() => onDownload('pdf')}>Download as PDF (.pdf)</MenuItem>
          <MenuItem onClick={() => onDownload('html')}>Download as HTML (.html)</MenuItem>
          <MenuItem onClick={() => onDownload('doc')}>Download as Word (.doc)</MenuItem>
          <MenuItem onClick={() => onDownload('txt')}>Download as Text (.txt)</MenuItem>
        </Menu>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
