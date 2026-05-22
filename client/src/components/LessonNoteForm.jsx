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
  Tooltip,
  IconButton,
  Collapse,
  FormControlLabel,
  Switch,
  MenuItem,
  Checkbox,
  ListItemText,
  Chip,
} from '@mui/material';
import { Article, OpenInFull, CloseFullscreen } from '@mui/icons-material';
import { useState, useEffect, useMemo, useRef } from 'react';

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TERM_TO_KEY = { one: 'one', two: 'two', three: 'three' };

const SUGGESTION_MAX = 5;
const SUGGESTION_FIELDS = ['school', 'facilitatorName', 'reference', 'contentStandardCode', 'indicatorCodes'];

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

function getSuggestionKey(classId, subjectId) {
  const userId = getCurrentUserId();
  if (userId && classId && subjectId) return `lernex-fsugg-${userId}-${classId}-${subjectId}`;
  return null;
}

function getFacilitatorMemoryKey(classId, subjectId, facilitatorName) {
  if (!classId || !subjectId || !facilitatorName) return null;
  const userId = getCurrentUserId();
  const normalizedFacilitator = String(facilitatorName).trim().toLowerCase();
  if (!userId || !normalizedFacilitator) return null;
  return `lernex-facilitator-memory-${userId}-${classId}-${subjectId}-${encodeURIComponent(normalizedFacilitator)}`;
}

function loadFieldSuggestions(classId, subjectId) {
  const key = getSuggestionKey(classId, subjectId);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function appendFieldSuggestions(classId, subjectId, values) {
  const key = getSuggestionKey(classId, subjectId);
  if (!key) return;
  try {
    const existing = loadFieldSuggestions(classId, subjectId);
    const updated = { ...existing };
    SUGGESTION_FIELDS.forEach((field) => {
      const val = (values[field] || '').trim();
      if (!val) return;
      const prev = Array.isArray(updated[field]) ? updated[field] : [];
      updated[field] = [val, ...prev.filter((v) => v !== val)].slice(0, SUGGESTION_MAX);
    });
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (_) {
    // non-blocking
  }
}

function loadFacilitatorMemory(classId, subjectId, facilitatorName) {
  const key = getFacilitatorMemoryKey(classId, subjectId, facilitatorName);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveFacilitatorMemory(classId, subjectId, facilitatorName, values) {
  const key = getFacilitatorMemoryKey(classId, subjectId, facilitatorName);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch (_) {
    // non-blocking
  }
}

function SuggestionChips({ options = [], onSelect }) {
  if (!options || options.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.4 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexBasis: '100%' }}>
        Suggestions:
      </Typography>
      {options.map((opt, i) => (
        <Chip
          key={i}
          label={opt.length > 50 ? `${opt.slice(0, 50)}…` : opt}
          size="small"
          variant="outlined"
          clickable
          onClick={() => onSelect(opt)}
          sx={{ fontSize: '0.72rem', maxWidth: '100%' }}
        />
      ))}
    </Box>
  );
}

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

function LessonNoteForm({
  open,
  onClose,
  onSubmit,
  subStrandName,
  selectedTopicNames = [],
  selectedTopics = [],
  isLoading,
  subStrandId,
  subStrandIds = [],
  defaultSchoolName = '',
  defaultFacilitatorName = '',
  schoolCalendar,
  fullScreen = false,
  onToggleFullscreen,
  classId,
  subjectId,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generateForRange, setGenerateForRange] = useState(false);
  const [weeklyOverrides, setWeeklyOverrides] = useState({});
  const [fieldSuggestions, setFieldSuggestions] = useState({});
  const formRef = useRef(null);
  const preferenceStorageKey = `lessonNoteFormPrefs-${getCurrentUserId()}`;

  const [formData, setFormData] = useState({
    school: '',
    facilitatorName: '',
    term: '',
    class: '',
    classSize: '',
    week: '',
    endWeek: '',
    contentStandardCode: '',
    indicatorCodes: '',
    reference: '',
    sessionsPerWeek: 1,
    sessionRows: buildSessionRows(1),
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
  const hasCalendarWeeks = weekOptions.length > 0;

  const selectedWeekEnding = useMemo(() => {
    const selectedWeek = Number(formData.week);
    if (!Number.isFinite(selectedWeek)) return null;
    const matched = weekOptions.find((entry) => Number(entry.weekNumber) === selectedWeek);
    return matched?.weekEnding || null;
  }, [formData.week, weekOptions]);

  const availableTopics = useMemo(() => {
    if (Array.isArray(selectedTopics) && selectedTopics.length > 0) {
      return selectedTopics
        .filter((topic) => topic?.id)
        .map((topic) => ({
          id: String(topic.id),
          name: topic.name || 'Topic',
          strandName: topic.strandName || '',
        }));
    }

    if (subStrandId && subStrandName) {
      return [{ id: String(subStrandId), name: subStrandName, strandName: '' }];
    }

    return [];
  }, [selectedTopics, subStrandId, subStrandName]);

  const startWeekNumber = Number(formData.week);

  const endWeekOptions = useMemo(() => {
    if (!hasCalendarWeeks || !Number.isFinite(startWeekNumber)) return weekOptions;
    return weekOptions.filter((entry) => Number(entry.weekNumber) >= startWeekNumber);
  }, [hasCalendarWeeks, startWeekNumber, weekOptions]);

  const weekTargets = useMemo(() => {
    const startWeek = Number(formData.week);
    const endWeek = Number(generateForRange ? (formData.endWeek || formData.week) : formData.week);

    if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) {
      return [];
    }

    const normalizedStart = Math.min(startWeek, endWeek);
    const normalizedEnd = Math.max(startWeek, endWeek);

    if (hasCalendarWeeks) {
      return weekOptions
        .filter((entry) => {
          const weekNo = Number(entry.weekNumber);
          return Number.isFinite(weekNo) && weekNo >= normalizedStart && weekNo <= normalizedEnd;
        })
        .map((entry) => ({
          weekNumber: Number(entry.weekNumber),
          weekEnding: entry.weekEnding || null,
        }));
    }

    const targets = [];
    for (let week = normalizedStart; week <= normalizedEnd; week += 1) {
      targets.push({ weekNumber: week, weekEnding: null });
    }
    return targets;
  }, [formData.week, formData.endWeek, generateForRange, hasCalendarWeeks, weekOptions]);

  const loadSavedPreferences = () => {
    try {
      const raw = localStorage.getItem(preferenceStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };

  useEffect(() => {
    if (open) {
      const savedPrefs = loadSavedPreferences();
      const initialFacilitator = defaultFacilitatorName || savedPrefs.facilitatorName || '';
      const memory = loadFacilitatorMemory(classId, subjectId, initialFacilitator);
      const initialSessions = memory?.sessionsPerWeek || savedPrefs.sessionsPerWeek || 1;

      setFieldSuggestions(loadFieldSuggestions(classId, subjectId));
      setFormData({
        school: defaultSchoolName || savedPrefs.school || '',
        facilitatorName: initialFacilitator,
        term: memory?.term || savedPrefs.term || '',
        class: '',
        classSize: memory?.classSize || savedPrefs.classSize || '',
        week: memory?.week || savedPrefs.week || '',
        endWeek: memory?.endWeek || savedPrefs.endWeek || '',
        contentStandardCode: memory?.contentStandardCode || savedPrefs.contentStandardCode || '',
        indicatorCodes: memory?.indicatorCodes || savedPrefs.indicatorCodes || '',
        reference: memory?.reference || savedPrefs.reference || '',
        sessionsPerWeek: initialSessions,
        sessionRows: memory?.sessionRows || buildSessionRows(initialSessions),
      });
      setShowAdvanced(false);
      setGenerateForRange(Boolean(memory?.generateForRange || savedPrefs.generateForRange));
      setWeeklyOverrides(memory?.weeklyOverrides || {});
    }
  }, [open, classId, subjectId, defaultFacilitatorName, defaultSchoolName]);

  useEffect(() => {
    const facilitatorName = String(formData.facilitatorName || '').trim();
    if (!facilitatorName || !classId || !subjectId) return;

    const memory = loadFacilitatorMemory(classId, subjectId, facilitatorName);
    if (!memory) return;

    setFormData((prev) => {
      const nextSessions = memory.sessionsPerWeek || prev.sessionsPerWeek || 1;
      return {
        ...prev,
        term: memory.term || prev.term,
        classSize: memory.classSize || prev.classSize,
        week: memory.week || prev.week,
        endWeek: memory.endWeek || prev.endWeek,
        contentStandardCode: memory.contentStandardCode || prev.contentStandardCode,
        indicatorCodes: memory.indicatorCodes || prev.indicatorCodes,
        reference: memory.reference || prev.reference,
        sessionsPerWeek: nextSessions,
        sessionRows: memory.sessionRows || prev.sessionRows || buildSessionRows(nextSessions),
      };
    });
    setGenerateForRange(Boolean(memory.generateForRange));
    setWeeklyOverrides(memory.weeklyOverrides || {});
  }, [formData.facilitatorName, classId, subjectId]);

  useEffect(() => {
    if (!generateForRange || weekTargets.length === 0) {
      setWeeklyOverrides({});
      return;
    }

    const defaultTopicIds = availableTopics.map((topic) => topic.id);

    setWeeklyOverrides((prev) => {
      const next = {};

      weekTargets.forEach((target) => {
        const key = String(target.weekNumber);
        const prevRow = prev[key] || {};
        const prevIds = Array.isArray(prevRow.subStrandIds) ? prevRow.subStrandIds : [];
        const validPrevIds = prevIds.filter((id) => defaultTopicIds.includes(id));

        next[key] = {
          subStrandIds: validPrevIds.length > 0 ? validPrevIds : defaultTopicIds,
          contentStandardCode: prevRow.contentStandardCode || '',
          indicatorCodes: prevRow.indicatorCodes || '',
        };
      });

      return next;
    });
  }, [generateForRange, weekTargets, availableTopics]);

  const updateSessionRows = (sessionsPerWeek, previousRows) => {
    return buildSessionRows(sessionsPerWeek, previousRows);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'term') {
      setFormData((prev) => ({
        ...prev,
        term: value,
        week: '',
        endWeek: '',
      }));
      return;
    }

    if (name === 'sessionsPerWeek') {
      setFormData((prev) => {
        const nextCount = Math.max(1, Math.min(7, Number(value) || 1));
        return {
          ...prev,
          sessionsPerWeek: nextCount,
          sessionRows: updateSessionRows(nextCount, prev.sessionRows),
        };
      });
      return;
    }

    if (name === 'week') {
      setFormData((prev) => {
        const next = { ...prev, week: value };
        if (generateForRange) {
          const startWeek = Number(value);
          const currentEndWeek = Number(prev.endWeek);
          if (!Number.isFinite(currentEndWeek) || currentEndWeek < startWeek) {
            next.endWeek = value;
          }
        }
        return next;
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

  const buildPayloadForWeek = ({ mode, weekNumber, weekEndingValue, weekOverride }) => {
    const sessionPlanLines = (formData.sessionRows || []).map((row) => {
      const computedDate = formatLongDate(computeDateFromWeekEndingAndDay(weekEndingValue, row.day));
      const dateSlot = computedDate || row.day;
      return `${dateSlot} | ${row.duration || '[AI: Session duration]'}`;
    });

    const firstSession = formData.sessionRows?.[0];
    const firstSessionDate = formatLongDate(computeDateFromWeekEndingAndDay(weekEndingValue, firstSession?.day));
    const defaultTopicIds = Array.isArray(subStrandIds) && subStrandIds.length > 0
      ? subStrandIds
      : (subStrandId ? [subStrandId] : []);
    const resolvedTopicIds = Array.isArray(weekOverride?.subStrandIds) && weekOverride.subStrandIds.length > 0
      ? weekOverride.subStrandIds
      : defaultTopicIds;

    return {
      ...formData,
      week: String(weekNumber || formData.week || ''),
      subStrandId: resolvedTopicIds[0] || subStrandId,
      subStrandIds: resolvedTopicIds,
      generationMode: mode,
      dayDate: firstSessionDate || firstSession?.day || '',
      weekEnding: toDateInputValue(weekEndingValue) || '',
      duration: '',
      contentStandardCode: weekOverride?.contentStandardCode ?? formData.contentStandardCode,
      indicatorCodes: weekOverride?.indicatorCodes ?? formData.indicatorCodes,
      sessionPlan: sessionPlanLines.join('\n'),
    };
  };

  const buildPayload = (mode) => {
    const targets = weekTargets.length > 0
      ? weekTargets
      : [{ weekNumber: formData.week || '', weekEnding: selectedWeekEnding || null }];
    const requests = targets.map((target) =>
      buildPayloadForWeek({
        mode,
        weekNumber: target.weekNumber,
        weekEndingValue: target.weekEnding,
        weekOverride: weeklyOverrides[String(target.weekNumber)],
      })
    );

    return {
      ...requests[0],
      requests,
      weekNumbers: targets.map((target) => target.weekNumber),
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
          week: formData.week,
          endWeek: formData.endWeek,
          generateForRange,
          contentStandardCode: formData.contentStandardCode,
          indicatorCodes: formData.indicatorCodes,
          reference: formData.reference,
          sessionsPerWeek: formData.sessionsPerWeek,
          sessionRows: formData.sessionRows,
          weeklyOverrides,
        })
      );
      appendFieldSuggestions(classId, subjectId, formData);
      saveFacilitatorMemory(classId, subjectId, formData.facilitatorName, {
        term: formData.term,
        classSize: formData.classSize,
        week: formData.week,
        endWeek: formData.endWeek,
        generateForRange,
        contentStandardCode: formData.contentStandardCode,
        indicatorCodes: formData.indicatorCodes,
        reference: formData.reference,
        sessionsPerWeek: formData.sessionsPerWeek,
        sessionRows: formData.sessionRows,
        weeklyOverrides,
      });
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

  const handleFormKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      scroll="paper"
      fullWidth
      maxWidth={fullScreen ? false : 'md'}
      disableEscapeKeyDown={isLoading}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Article color="primary" />
            <Typography variant="h6">Generate AI Lesson Note</Typography>
          </Box>
          {onToggleFullscreen && (
            <Tooltip title={fullScreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
              <IconButton
                size="small"
                aria-label={fullScreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={onToggleFullscreen}
              >
                {fullScreen ? <CloseFullscreen fontSize="small" /> : <OpenInFull fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Select one week or a week range and lesson day(s). Dates are auto-derived from your school term calendar.
        </Typography>
      </DialogTitle>

      <form ref={formRef} onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
        <DialogContent tabIndex={0} sx={{ overflowY: 'auto' }}>
          {isLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={60} sx={{ mb: 3 }} />
              <Typography variant="h6" gutterBottom>
                Generating Your Lesson Note...
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                This may take 30-60 seconds.
              </Typography>
              <Stepper activeStep={0} alternativeLabel sx={{ mt: 3 }}>
                <Step><StepLabel>Teacher Note</StepLabel></Step>
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
                  Selected Topic{selectedTopicNames.length > 1 ? 's' : ''}:
                </Typography>
                {selectedTopicNames.length > 1 ? (
                  <Stack spacing={0.5}>
                    {selectedTopicNames.map((topicName, index) => (
                      <Typography key={`${topicName}-${index}`} variant="body1" sx={{ fontWeight: 600 }}>
                        - {topicName}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="h6">{subStrandName || 'N/A'}</Typography>
                )}
              </Box>

              <TextField
                name="school"
                label="School Name"
                value={formData.school}
                onChange={handleChange}
                fullWidth
              />
              <SuggestionChips
                options={fieldSuggestions.school}
                onSelect={(val) => setFormData((prev) => ({ ...prev, school: val }))}
              />

              <TextField
                name="facilitatorName"
                label="Facilitator Name"
                value={formData.facilitatorName}
                onChange={handleChange}
                fullWidth
              />
              <SuggestionChips
                options={fieldSuggestions.facilitatorName}
                onSelect={(val) => setFormData((prev) => ({ ...prev, facilitatorName: val }))}
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
                  label="Week Number"
                  value={formData.week}
                  onChange={handleChange}
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

              <FormControlLabel
                control={(
                  <Switch
                    checked={generateForRange}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setGenerateForRange(checked);
                      if (checked) {
                        setFormData((prev) => ({
                          ...prev,
                          endWeek: prev.endWeek || prev.week,
                        }));
                      } else {
                        setFormData((prev) => ({ ...prev, endWeek: '' }));
                      }
                    }}
                  />
                )}
                label="Generate for a week range"
              />

              {generateForRange && (
                <TextField
                  select={hasCalendarWeeks}
                  name="endWeek"
                  label="End Week"
                  value={formData.endWeek}
                  onChange={handleChange}
                  type={hasCalendarWeeks ? undefined : 'number'}
                  inputProps={hasCalendarWeeks ? undefined : { min: 1, max: 20 }}
                  helperText={hasCalendarWeeks ? 'Choose the last week to include' : 'Enter the last week number in the range'}
                  fullWidth
                >
                  {hasCalendarWeeks ? endWeekOptions.map((entry) => (
                    <MenuItem key={`end-${termKey}-${entry.weekNumber}`} value={String(entry.weekNumber)}>
                      Week {entry.weekNumber} (Ending {toDateInputValue(entry.weekEnding)})
                    </MenuItem>
                  )) : null}
                </TextField>
              )}

              {generateForRange && weekTargets.length > 0 && (
                <Box sx={{ p: 1.5, borderRadius: 1.5, border: '1px dashed', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.2 }}>Weekly Curriculum Mapping</Typography>
                  <Stack spacing={1.4}>
                    {weekTargets.map((target) => {
                      const weekKey = String(target.weekNumber);
                      const weekRow = weeklyOverrides[weekKey] || { subStrandIds: [], contentStandardCode: '', indicatorCodes: '' };
                      return (
                        <Box key={`weekly-override-${weekKey}`} sx={{ p: 1.2, borderRadius: 1.2, border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Week {target.weekNumber}
                          </Typography>
                          <Stack spacing={1}>
                            <TextField
                              select
                              SelectProps={{
                                multiple: true,
                                renderValue: (selected) => {
                                  const ids = Array.isArray(selected) ? selected : [];
                                  return availableTopics
                                    .filter((topic) => ids.includes(topic.id))
                                    .map((topic) => topic.strandName ? `${topic.strandName} - ${topic.name}` : topic.name)
                                    .join(', ');
                                },
                              }}
                              label="Sub-Strands for this week"
                              value={weekRow.subStrandIds}
                              onChange={(event) => {
                                const value = event.target.value;
                                const nextIds = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
                                setWeeklyOverrides((prev) => ({
                                  ...prev,
                                  [weekKey]: {
                                    ...(prev[weekKey] || {}),
                                    subStrandIds: nextIds,
                                  },
                                }));
                              }}
                              fullWidth
                            >
                              {availableTopics.map((topic) => (
                                <MenuItem key={`${weekKey}-${topic.id}`} value={topic.id}>
                                  <Checkbox checked={weekRow.subStrandIds.includes(topic.id)} size="small" />
                                  <ListItemText primary={topic.name} secondary={topic.strandName ? `Strand: ${topic.strandName}` : undefined} />
                                </MenuItem>
                              ))}
                            </TextField>

                            <Box>
                              <TextField
                                label="Content Standard Code (Week-specific)"
                                value={weekRow.contentStandardCode}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setWeeklyOverrides((prev) => ({
                                    ...prev,
                                    [weekKey]: {
                                      ...(prev[weekKey] || {}),
                                      contentStandardCode: value,
                                    },
                                  }));
                                }}
                                fullWidth
                                multiline
                                minRows={2}
                              />
                              <SuggestionChips
                                options={fieldSuggestions.contentStandardCode}
                                onSelect={(val) => setWeeklyOverrides((prev) => ({
                                  ...prev,
                                  [weekKey]: { ...(prev[weekKey] || {}), contentStandardCode: val },
                                }))}
                              />
                            </Box>

                            <Box>
                              <TextField
                                label="Indicator(s) (Week-specific)"
                                value={weekRow.indicatorCodes}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setWeeklyOverrides((prev) => ({
                                    ...prev,
                                    [weekKey]: {
                                      ...(prev[weekKey] || {}),
                                      indicatorCodes: value,
                                    },
                                }));
                              }}
                              fullWidth
                              multiline
                              minRows={2}
                            />
                              <SuggestionChips
                                options={fieldSuggestions.indicatorCodes}
                                onSelect={(val) => setWeeklyOverrides((prev) => ({
                                  ...prev,
                                  [weekKey]: { ...(prev[weekKey] || {}), indicatorCodes: val },
                                }))}
                              />
                            </Box>
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              )}

              <TextField
                name="classSize"
                label="Class Size"
                value={formData.classSize}
                onChange={handleChange}
                type="number"
                inputProps={{ min: 1, max: 200 }}
                fullWidth
              />

              <TextField
                name="sessionsPerWeek"
                label="Meetings Per Week"
                value={formData.sessionsPerWeek}
                onChange={handleChange}
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
                          label={`Session ${index + 1} Time/Duration`}
                          value={row.duration}
                          onChange={(event) => handleSessionRowChange(index, 'duration', event.target.value)}
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
                  <Box>
                    <TextField
                      name="contentStandardCode"
                      label="Content Standard Code"
                      value={formData.contentStandardCode}
                      onChange={handleChange}
                      fullWidth
                      multiline
                      minRows={2}
                      placeholder="e.g., B7.1.2.3"
                    />
                    <SuggestionChips
                      options={fieldSuggestions.contentStandardCode}
                      onSelect={(val) => setFormData((prev) => ({ ...prev, contentStandardCode: val }))}
                    />
                  </Box>

                  <Box>
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
                    <SuggestionChips
                      options={fieldSuggestions.indicatorCodes}
                      onSelect={(val) => setFormData((prev) => ({ ...prev, indicatorCodes: val }))}
                    />
                  </Box>

                  <Box>
                    <TextField
                      name="reference"
                      label="Reference"
                      value={formData.reference}
                      onChange={handleChange}
                      fullWidth
                      placeholder="e.g., NaCCA Computing Curriculum for Basic 7"
                    />
                    <SuggestionChips
                      options={fieldSuggestions.reference}
                      onSelect={(val) => setFormData((prev) => ({ ...prev, reference: val }))}
                    />
                  </Box>
                </Stack>
              </Collapse>
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
            startIcon={isLoading ? <CircularProgress size={20} /> : null}
            sx={{ minWidth: 220 }}
          >
            {isLoading ? 'Generating...' : 'Customize Then Generate'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default LessonNoteForm;
