/**
 * NoteFlow Mini Program - Flashcard API Service
 */

const { request } = require('../utils/request');

module.exports = {
  /** Generate flashcards from a note */
  generate: (taskId) => request({
    url: '/api/flashcards/generate',
    method: 'POST',
    data: { task_id: taskId },
  }),

  /** Get a flashcard set */
  getSet: (setId) => request({
    url: `/api/flashcards/set/${setId}`,
    suppressToast: true,
  }),

  /** List all flashcard sets */
  listSets: () => request({
    url: '/api/flashcards/sets',
    suppressToast: true,
  }),

  /** Update study progress */
  updateProgress: (setId, cardId, difficulty) => request({
    url: `/api/flashcards/progress`,
    method: 'POST',
    data: { set_id: setId, card_id: cardId, difficulty },
  }),

  /** Delete a flashcard set */
  deleteSet: (setId) => request({
    url: `/api/flashcards/set/${setId}`,
    method: 'DELETE',
  }),
};
