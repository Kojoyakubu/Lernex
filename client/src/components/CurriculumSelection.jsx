import React from 'react';
import { Grid, FormControl, InputLabel, Select, MenuItem } from '@mui/material';

const CurriculumSelection = ({
  levels,
  classes,
  subjects,
  strands,
  subStrands,
  selections,
  handleSelectionChange,
  isLoading,
  allowStrandWithoutSubject = false,
}) => (
  <Grid container spacing={2}>
    <Grid item xs={12} sm={6}>
      <FormControl fullWidth size="small">
        <InputLabel>Level</InputLabel>
        <Select name="level" value={selections.level} label="Level" onChange={handleSelectionChange}>
          {(levels || []).map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Grid>
    <Grid item xs={12} sm={6}>
      <FormControl fullWidth size="small" disabled={!selections.level}>
        <InputLabel>Class</InputLabel>
        <Select name="class" value={selections.class} label="Class" onChange={handleSelectionChange}>
          {(classes || []).map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Grid>
    <Grid item xs={12} sm={6}>
      <FormControl fullWidth size="small" disabled={!selections.class || allowStrandWithoutSubject}>
        <InputLabel>{allowStrandWithoutSubject ? 'Subject (optional)' : 'Subject'}</InputLabel>
        <Select
          name="subject"
          value={selections.subject}
          label={allowStrandWithoutSubject ? 'Subject (optional)' : 'Subject'}
          onChange={handleSelectionChange}
        >
          {allowStrandWithoutSubject && (
            <MenuItem value="" disabled>
              No subject selection required for this class
            </MenuItem>
          )}
          {(subjects || []).map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Grid>
    <Grid item xs={12} sm={6}>
      <FormControl fullWidth size="small" disabled={!selections.subject && !allowStrandWithoutSubject}>
        <InputLabel>Learning Area / Strand</InputLabel>
        <Select name="strand" value={selections.strand} label="Learning Area / Strand" onChange={handleSelectionChange}>
          {(strands || []).map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Grid>
    <Grid item xs={12}>
      <FormControl fullWidth size="small" disabled={!selections.strand}>
        <InputLabel>Sub-Strand</InputLabel>
        <Select name="subStrand" value={selections.subStrand} label="Sub-Strand" onChange={handleSelectionChange}>
          {(subStrands || []).map((item) => <MenuItem key={item._id} value={item._id}>{item.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Grid>
  </Grid>
);

export default CurriculumSelection;
