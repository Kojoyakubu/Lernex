import api from '../../api/axios';

const generateAgentLessons = async ({ request, classId, subjectId, term, weeks, regenerate, curriculumSelections }) => {
  const response = await api.post('/api/teacher/agent/generate', {
    request,
    classId,
    subjectId,
    term,
    weeks,
    regenerate,
    curriculumSelections,
  });
  return response.data;
};

export default { generateAgentLessons };