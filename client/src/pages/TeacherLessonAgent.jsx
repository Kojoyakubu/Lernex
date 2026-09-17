import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import lessonAgentService from '../features/teacher/lessonAgentService';

export default function TeacherLessonAgent() {
  const [request, setRequest] = useState('');
  const [regenerate, setRegenerate] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [curriculumSelections, setCurriculumSelections] = useState({});

  const submit = async (event) => {
    event?.preventDefault();
    if (!request.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await lessonAgentService.generateAgentLessons({
        request: request.trim(),
        regenerate,
        curriculumSelections,
      }));
    } catch (agentError) {
      setError(agentError.response?.data?.message || 'I could not prepare that lesson request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto' }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>Lesson Generation Agent</Typography>
        <Typography color="text.secondary">Describe the lesson you want. Lernex will use your confirmed scheme, school calendar, and existing lesson generator.</Typography>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper component="form" onSubmit={submit} sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
        <TextField
          fullWidth
          multiline
          minRows={3}
          label="What should I generate?"
          placeholder="Generate my Basic 4 Computing lesson for Week 3."
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          disabled={loading}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 2 }}>
          <Button type="submit" variant="contained" startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />} disabled={loading || !request.trim()}>
            {loading ? 'Generating...' : 'Generate Lesson'}
          </Button>
          <Button type="button" variant={regenerate ? 'contained' : 'outlined'} onClick={() => setRegenerate((current) => !current)} disabled={loading}>
            {regenerate ? 'Regeneration enabled' : 'Regenerate existing lesson'}
          </Button>
        </Stack>
      </Paper>
      {result && <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>Generation report</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{result.class?.name} • {result.subject?.name} • {result.term}</Typography>
        <Stack spacing={1}>{result.results?.map((item) => <Box key={item.week}>
          <Alert severity={item.status === 'failed' ? 'error' : item.status === 'existing' ? 'info' : 'success'} icon={item.status === 'failed' ? <ErrorOutlineIcon /> : <CheckCircleOutlineIcon />}>
            Week {item.week}: {item.status === 'failed' ? item.error : item.status === 'existing' ? 'A lesson already exists. Use regeneration if you want to replace it.' : item.status === 'regenerated' ? 'Lesson regenerated successfully.' : 'Lesson generated and saved.'}
          </Alert>
          {item.selectionRequired && <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>Select the curriculum topic for Week {item.week} so I can continue.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <FormControl fullWidth size="small"><InputLabel>Strand / Sub-strand</InputLabel><Select label="Strand / Sub-strand" value={curriculumSelections[item.week]?.subStrandId || ''} onChange={(event) => setCurriculumSelections((current) => ({ ...current, [item.week]: { subStrandId: event.target.value, strandId: item.options.find((option) => option.subStrandId === event.target.value)?.strandId || '' } }))}>{(item.options || []).map((option) => <MenuItem key={option.subStrandId} value={option.subStrandId}>{option.strandName} / {option.subStrandName}</MenuItem>)}</Select></FormControl>
              <Button variant="contained" disabled={loading || !curriculumSelections[item.week]?.subStrandId} onClick={() => submit(null, true)}>Continue</Button>
            </Stack>
          </Paper>}
        </Box>)}</Stack>
        <Typography sx={{ mt: 2 }} fontWeight={600}>{result.summary?.generated || 0} generated, {result.summary?.existing || 0} already existed, {result.summary?.failed || 0} failed.</Typography>
      </Paper>}
    </Box>
  );
}