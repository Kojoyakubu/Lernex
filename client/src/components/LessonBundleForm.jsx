import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  TextField,
  CircularProgress,
  Stack,
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Collapse,
  FormControlLabel,
  Switch,
  MenuItem,
} from '@mui/material';
import { useState, useEffect, useMemo } from 'react';
import { AutoAwesome } from '@mui/icons-material';

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TERM_TO_KEY = { one: 'one', two: 'two', three: 'three' };

const toDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const computeDateFromWeekEndingAndDay = (weekEnding, dayName) => {
  if (!weekEnding || !dayName) return '';
  const date = new Date(weekEnding);
  if (Number.isNaN(date.getTime())) return '';

  const offsets = {
    Monday: -4,
    Tuesday: -3,
    Wednesday: -2,
    Thursday: -1,
    Friday: 0,
    Saturday: 1,
    Sunday: 2,
  };

  const offset = offsets[dayName] ?? 0;
  const result = new Date(date);
  result.setDate(result.getDate() + offset);
  return result;
};

const formatLongDate = (date) => {
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const buildSessionRows = (count, previous = []) => {
  const nextCount = Math.max(1, Number(count) || 1);
  return Array.from({ length: nextCount }, (_, index) => {
    const prev = previous[index] || {};
    return {
      day: prev.day || DAY_OPTIONS[Math.min(index, DAY_OPTIONS.length - 1)] || 'Monday',
      duration: prev.duration || '',
    };
  });
};

function getCurrentUserId() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return '';
    const user = JSON.parse(raw);
    return String(user?._id || user?.id || '').trim();
  } catch (_) {
    return '';
  }
}

function LessonBundleForm({
  open,
  onClose,
  onSubmit,
  subStrandName,
  isLoading,
  subStrandId,
  defaultFacilitatorName = '',
  defaultSchoolName = '',
  schoolCalendar,
}) {
  const preferenceStorageKey = `lernex:lesson-bundle-form-prefs-${getCurrentUserId()}`;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [formData, setFormData] = useState({
    school: defaultSchoolName || '',
    facilitatorName: '',
    term: 'One',
    classSize: '',
    week: '',
    contentStandardCode: '',
    indicatorCodes: '',
    reference: '',
    sessionsPerWeek: 1,
    sessionRows: buildSessionRows(1),
    numQuestions: 20,
  });

  const calendarByTerm = useMemo(() => {
    const tc = schoolCalendar?.termCalendar || {};
    return {
      one: Array.isArray(tc.one) ? tc.one : [],
      two: Array.isArray(tc.two) ? tc.two : [],
      three: Array.isArray(tc.three) ? tc.three : [],
    };
  }, [schoolCalendar]);

  const termKey = TERM_TO_KEY[String(formData.term || '').toLowerCase()] || 'one';
  const weekOptions = calendarByTerm[termKey] || [];

  const selectedWeekEnding = useMemo(() => {
    const selectedWeek = Number(formData.week);
    if (!Number.isFinite(selectedWeek)) return null;
    const matched = weekOptions.find((entry) => Number(entry.weekNumber) === selectedWeek);
    return matched?.weekEnding || null;
  }, [formData.week, weekOptions]);

  useEffect(() => {
    if (open) {
      let savedPrefs = {};
      try {
        savedPrefs = JSON.parse(localStorage.getItem(preferenceStorageKey) || '{}');
      } catch (_) {
        savedPrefs = {};
      }

      const initialSessions = Math.max(1, Number(savedPrefs.sessionsPerWeek) || 1);
      setFormData({
        school: defaultSchoolName || savedPrefs.school || '',
        facilitatorName: defaultFacilitatorName || savedPrefs.facilitatorName || '',
        term: savedPrefs.term || 'One',
        classSize: savedPrefs.classSize || '',
        week: '',
        contentStandardCode: savedPrefs.contentStandardCode || '',
        indicatorCodes: savedPrefs.indicatorCodes || '',
        reference: savedPrefs.reference || '',
        sessionsPerWeek: initialSessions,
        sessionRows: buildSessionRows(initialSessions, savedPrefs.sessionRows || []),
        numQuestions: savedPrefs.numQuestions || 20,
      });
      setShowAdvanced(false);
    }
  }, [open, defaultFacilitatorName, defaultSchoolName]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'sessionsPerWeek') {
      setFormData((prev) => {
        const nextCount = Math.max(1, Math.min(7, Number(value) || 1));
        return {
          ...prev,
          sessionsPerWeek: nextCount,
          sessionRows: buildSessionRows(nextCount, prev.sessionRows),
        };
      });
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSessionRowChange = (index, field, value) => {
    setFormData((prev) => {
      const rows = [...prev.sessionRows];
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, sessionRows: rows };
    });
  };

  const buildPayload = (mode) => {
    const sessionPlanLines = (formData.sessionRows || []).map((row) => {
      const computedDate = formatLongDate(computeDateFromWeekEndingAndDay(selectedWeekEnding, row.day));
      const dateSlot = computedDate || row.day;
      return `${dateSlot} | ${row.duration || '[AI: Session duration]'}`;
    });

    const firstSession = formData.sessionRows?.[0];
    const firstSessionDate = formatLongDate(computeDateFromWeekEndingAndDay(selectedWeekEnding, firstSession?.day));

    return {
      ...formData,
      subStrandId,
      generationMode: mode,
      dayDate: firstSessionDate || firstSession?.day || '',
      weekEnding: toDateInputValue(selectedWeekEnding) || '',
      duration: '',
      sessionPlan: sessionPlanLines.join('\n'),
    };
  };

  const persistPreferences = () => {
    try {
      localStorage.setItem(
        preferenceStorageKey,
        JSON.stringify({
          school: formData.school,
          facilitatorName: formData.facilitatorName,
          term: formData.term,
          classSize: formData.classSize,
          contentStandardCode: formData.contentStandardCode,
          indicatorCodes: formData.indicatorCodes,
          reference: formData.reference,
          sessionsPerWeek: formData.sessionsPerWeek,
          sessionRows: formData.sessionRows,
          numQuestions: formData.numQuestions,
        })
      );
    } catch (_) {
      // Non-blocking: preference storage should not stop submission.
    }
  };

  const handleSubmitWithMode = (mode) => {
    persistPreferences();
    onSubmit(buildPayload(mode));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSubmitWithMode(showAdvanced ? 'custom' : 'fast');
  };

  const hasCalendarWeeks = weekOptions.length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" disableEscapeKeyDown={isLoading}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesome color="primary" />
          <Typography variant="h6">Generate Complete Lesson Bundle with AI</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Select week and lesson day(s). Dates are auto-derived from your school term calendar.
        </Typography>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent>
          {isLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={60} sx={{ mb: 3 }} />
              <Typography variant="h6" gutterBottom>
                Generating Your Lesson Bundle...
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                This may take 30-90 seconds as we generate all three components.
              </Typography>
              <Stepper activeStep={-1} alternativeLabel sx={{ mt: 3 }}>
                <Step><StepLabel>Teacher Note</StepLabel></Step>
                <Step><StepLabel>Learner Note</StepLabel></Step>
                <Step><StepLabel>Quiz (4 Types)</StepLabel></Step>
              </Stepper>
            </Box>
          ) : (
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <Box
                sx={{
                  p: 2,
                  bgcolor: 'primary.50',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'primary.200',
                }}
              >
                <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Selected Topic:
                </Typography>
                <Typography variant="h6">{subStrandName || 'N/A'}</Typography>
              </Box>

              <TextField
                name="school"
                label="School Name"
                value={formData.school}
                onChange={handleChange}
                fullWidth
              />

              <TextField
                name="facilitatorName"
                label="Facilitator Name"
                value={formData.facilitatorName}
                onChange={handleChange}
                fullWidth
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  name="term"
                  label="Term"
                  value={formData.term}
                  onChange={handleChange}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="One">One</MenuItem>
                  <MenuItem value="Two">Two</MenuItem>
                  <MenuItem value="Three">Three</MenuItem>
                </TextField>
                <TextField
                  select={hasCalendarWeeks}
                  name="week"
                  label="Week Number *"
                  value={formData.week}
                  onChange={handleChange}
                  required
                  type={hasCalendarWeeks ? undefined : 'number'}
                  inputProps={hasCalendarWeeks ? undefined : { min: 1, max: 20 }}
                  helperText={hasCalendarWeeks ? 'Admin-configured weeks for selected term' : 'No term calendar configured yet; enter week manually.'}
                  sx={{ flex: 1 }}
                >
                  {hasCalendarWeeks ? weekOptions.map((entry) => (
                    <MenuItem key={`${termKey}-${entry.weekNumber}`} value={String(entry.weekNumber)}>
                      Week {entry.weekNumber} (Ending {toDateInputValue(entry.weekEnding)})
                    </MenuItem>
                  )) : null}
                </TextField>
              </Stack>

              <TextField
                name="classSize"
                label="Class Size *"
                value={formData.classSize}
                onChange={handleChange}
                required
                type="number"
                inputProps={{ min: 1, max: 200 }}
                fullWidth
              />

              <TextField
                name="sessionsPerWeek"
                label="Meetings Per Week *"
                value={formData.sessionsPerWeek}
                onChange={handleChange}
                required
                type="number"
                inputProps={{ min: 1, max: 7 }}
                fullWidth
              />

              <Box sx={{ p: 1.5, borderRadius: 1.5, border: '1px dashed', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Session Schedule</Typography>
                <Stack spacing={1.2}>
                  {(formData.sessionRows || []).map((row, index) => {
                    const computedDate = formatLongDate(computeDateFromWeekEndingAndDay(selectedWeekEnding, row.day));
                    return (
                      <Stack key={`session-${index}`} direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <TextField
                          select
                          label={`Session ${index + 1} Day`}
                          value={row.day}
                          onChange={(event) => handleSessionRowChange(index, 'day', event.target.value)}
                          sx={{ flex: 1 }}
                        >
                          {DAY_OPTIONS.map((day) => (
                            <MenuItem key={day} value={day}>{day}</MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          label={`Session ${index + 1} Time/Duration *`}
                          value={row.duration}
                          onChange={(event) => handleSessionRowChange(index, 'duration', event.target.value)}
                          required
                          sx={{ flex: 1 }}
                          placeholder="e.g., 35 mins / 1 Period"
                        />
                        <TextField
                          label="Auto Date"
                          value={computedDate || 'Waiting for week ending setup'}
                          InputProps={{ readOnly: true }}
                          sx={{ flex: 1 }}
                        />
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>

              <FormControlLabel
                control={(
                  <Switch
                    checked={showAdvanced}
                    onChange={(event) => setShowAdvanced(event.target.checked)}
                  />
                )}
                label="Customize details (advanced)"
              />

              <Collapse in={showAdvanced} timeout="auto" unmountOnExit>
                <Stack spacing={2.5}>
                  <TextField
                    name="contentStandardCode"
                    label="Content Standard Code"
                    value={formData.contentStandardCode}
                    onChange={handleChange}
                    fullWidth
                    placeholder="e.g., B7.1.2.3"
                  />

                  <TextField
                    name="indicatorCodes"
                    label="Official NaCCA Indicator(s)"
                    value={formData.indicatorCodes}
                    onChange={handleChange}
                    fullWidth
                    multiline
                    rows={3}
                    helperText="Optional. If empty, AI will infer suitable indicators from the selected topic."
                  />

                  <TextField
                    name="reference"
                    label="Reference"
                    value={formData.reference}
                    onChange={handleChange}
                    fullWidth
                    placeholder="e.g., NaCCA Computing Curriculum for Basic 7"
                  />
                </Stack>
              </Collapse>

              <TextField
                name="numQuestions"
                label="Number of MCQ Questions"
                value={formData.numQuestions}
                onChange={handleChange}
                type="number"
                inputProps={{ min: 5, max: 30 }}
                helperText="Note: True/False (5-10), Short Answer (5-10), Essay (3-5) are auto-generated"
                fullWidth
              />
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outlined"
            disabled={isLoading}
            onClick={() => handleSubmitWithMode('fast')}
            sx={{ minWidth: 150 }}
          >
            Generate Fast
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={20} /> : <AutoAwesome />}
            sx={{ minWidth: 220 }}
          >
            {isLoading ? 'Generating...' : 'Customize Then Generate'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default LessonBundleForm;
