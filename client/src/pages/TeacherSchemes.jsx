import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { fetchItems, fetchChildren, clearChildren } from '../features/curriculum/curriculumSlice';
import schemeService from '../features/schemes/schemeService';

const TERMS = ['First Term', 'Second Term', 'Third Term'];
const emptySelection = { level: '', classId: '', subjectId: '', term: '' };

const entryToForm = (entry) => ({
  ...entry,
  weeks: Array.isArray(entry.weeks) ? entry.weeks.join(', ') : '',
  indicators: Array.isArray(entry.indicators)
    ? entry.indicators.map((indicator) => [indicator.code, indicator.description].filter(Boolean).join(' - ')).join('\n')
    : '',
});

const formToEntry = (entry) => ({
  ...entry,
  weeks: String(entry.weeks || '').split(/[, ]+/).map(Number).filter((week) => Number.isInteger(week) && week > 0),
  indicators: String(entry.indicators || '').split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(/^([^\s-]+)\s*-\s*(.*)$/);
    return match ? { code: match[1], description: match[2] } : { code: '', description: item };
  }),
});

export default function TeacherSchemes() {
  const dispatch = useDispatch();
  const { levels, classes, subjects } = useSelector((state) => state.curriculum);
  const [selection, setSelection] = useState(emptySelection);
  const [schemes, setSchemes] = useState([]);
  const [reviewScheme, setReviewScheme] = useState(null);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewEntries, setReviewEntries] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    dispatch(fetchItems({ entity: 'levels' }));
    schemeService.getMySchemes().then(setSchemes).catch(() => setError('Unable to load your schemes.'));
  }, [dispatch]);

  const choose = (field, value) => {
    setError('');
    if (field === 'level') {
      setSelection({ ...emptySelection, level: value });
      dispatch(fetchChildren({ entity: 'classes', parentEntity: 'levels', parentId: value }));
      return;
    }
    if (field === 'classId') {
      setSelection((current) => ({ ...current, classId: value, subjectId: '', term: '' }));
      dispatch(clearChildren({ entities: ['strands', 'subStrands'] }));
      dispatch(fetchChildren({ entity: 'subjects', parentEntity: 'classes', parentId: value }));
      return;
    }
    setSelection((current) => ({ ...current, [field]: value }));
  };

  const handleUpload = async () => {
    if (!selection.classId || !selection.subjectId || !selection.term || !file) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await schemeService.uploadScheme({ ...selection, file });
      const importedSchemes = result.schemes || (result.scheme ? [result.scheme] : []);
      setSchemes((current) => [...importedSchemes, ...current]);
      setReviewScheme(importedSchemes[0]);
      setReviewQueue(importedSchemes.slice(1));
      setReviewEntries(importedSchemes[0].entries.map(entryToForm));
      setMessage(result.message);
      setFile(null);
    } catch (uploadError) {
      setError(uploadError.response?.data?.message || 'The scheme could not be analysed.');
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    setLoading(true);
    try {
      const updated = await schemeService.updateScheme({
        schemeId: reviewScheme._id,
        entries: reviewEntries.map(formToEntry),
        importStatus: 'confirmed',
      });
      setSchemes((current) => current.map((scheme) => scheme._id === updated._id ? updated : scheme));
      if (reviewQueue.length) {
        const [nextScheme, ...remaining] = reviewQueue;
        setReviewQueue(remaining);
        setReviewScheme(nextScheme);
        setReviewEntries(nextScheme.entries.map(entryToForm));
        setMessage(`${updated.subject?.name || 'Subject'} confirmed. Review the next subject scheme.`);
      } else {
        setReviewScheme(null);
        setMessage('Scheme import completed successfully.');
      }
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'The scheme could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (scheme) => {
    const label = `${scheme.class?.name || 'class'} • ${scheme.subject?.name || 'subject'} • ${scheme.term}`;
    if (!window.confirm(`Archive the scheme for ${label}? It will no longer be used for lesson generation.`)) return;

    setLoading(true);
    setError('');
    try {
      await schemeService.archiveScheme(scheme._id);
      setSchemes((current) => current.filter((item) => item._id !== scheme._id));
      if (reviewScheme?._id === scheme._id) setReviewScheme(null);
      setMessage('Scheme archived successfully.');
    } catch (archiveError) {
      setError(archiveError.response?.data?.message || 'The scheme could not be archived.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>My Schemes</Typography>
        <Typography color="text.secondary">Upload a scheme once, review what Lernex found, and reuse it when preparing lessons.</Typography>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      <Paper sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Upload Scheme of Learning</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <FormControl fullWidth><InputLabel>Level</InputLabel><Select value={selection.level} label="Level" onChange={(event) => choose('level', event.target.value)}>{levels.map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}</Select></FormControl>
          <FormControl fullWidth><InputLabel>Class</InputLabel><Select value={selection.classId} label="Class" disabled={!selection.level} onChange={(event) => choose('classId', event.target.value)}>{classes.map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}</Select></FormControl>
          <FormControl fullWidth><InputLabel>Subject</InputLabel><Select value={selection.subjectId} label="Subject" disabled={!selection.classId} onChange={(event) => choose('subjectId', event.target.value)}><MenuItem value="">Whole class document</MenuItem>{subjects.map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}</Select></FormControl>
          <FormControl fullWidth><InputLabel>Term</InputLabel><Select value={selection.term} label="Term" disabled={!selection.classId} onChange={(event) => choose('term', event.target.value)}>{TERMS.map((term) => <MenuItem key={term} value={term}>{term}</MenuItem>)}</Select></FormControl>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 2 }}>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}> {file?.name || 'Choose scheme file'} <input hidden type="file" accept=".docx,.xlsx,.xls,.pdf,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></Button>
          <Button variant="contained" onClick={handleUpload} disabled={loading || !selection.classId || !selection.term || !file}>{loading ? <CircularProgress size={22} /> : 'Upload & Analyse'}</Button>
        </Stack>
      </Paper>
      <Stack spacing={2}>
        {schemes.map((scheme) => <Paper key={scheme._id} sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Typography fontWeight={700}>{scheme.class?.name || 'Class'} • {scheme.subject?.name || 'Subject'}</Typography><Typography color="text.secondary">{scheme.term} • {scheme.entries?.length || 0} curriculum rows • {scheme.importStatus === 'confirmed' ? 'Imported' : 'Review required'}</Typography></Box><Stack direction="row" spacing={1}><Button onClick={() => { setReviewScheme(scheme); setReviewEntries((scheme.entries || []).map(entryToForm)); }}>Review</Button><Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => handleArchive(scheme)} disabled={loading}>Archive</Button></Stack></Stack></Paper>)}
      </Stack>
      <Dialog open={Boolean(reviewScheme)} onClose={() => setReviewScheme(null)} fullWidth maxWidth="xl">
        <DialogTitle>Review Imported Scheme</DialogTitle>
        <DialogContent>
          {reviewScheme && <Typography color="text.secondary" sx={{ mb: 2 }}>{reviewScheme.class?.name || 'Selected class'} • {reviewScheme.subject?.name || 'Selected subject'} • {reviewScheme.term}</Typography>}
          <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow>{['Weeks', 'Strand', 'Sub-strand', 'Content Standard', 'Indicators', 'Review'].map((heading) => <TableCell key={heading}>{heading}</TableCell>)}</TableRow></TableHead><TableBody>{reviewEntries.map((entry, index) => <TableRow key={entry._id || index}>{['weeks', 'strand', 'subStrand', 'contentStandard', 'indicators'].map((field) => <TableCell key={field} sx={{ minWidth: field === 'indicators' ? 280 : 160 }}><TextField fullWidth multiline={field === 'indicators'} minRows={field === 'indicators' ? 3 : 1} size="small" value={entry[field] || ''} onChange={(event) => setReviewEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item))} /></TableCell>)}<TableCell>{entry.needsReview ? <Alert severity="warning">Needs review</Alert> : <CheckIcon color="success" />}</TableCell></TableRow>)}</TableBody></Table></Box>
        </DialogContent>
        <DialogActions><Button onClick={() => setReviewScheme(null)}>Cancel</Button><Button variant="contained" onClick={confirmImport} disabled={loading} startIcon={<CheckIcon />}>Confirm Import</Button></DialogActions>
      </Dialog>
    </Box>
  );
}