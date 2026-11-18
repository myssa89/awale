/*
 * Guided lessons. Each lesson is a position (South to move) plus a goal.
 * The text for each lesson, in every language, is in i18n.js (lessonText).
 * goal.type: 'any' (any legal move), 'capture' (capture >= min seeds in one move).
 * tests/engine.test.js checks every lesson is solvable.
 */
(function (root) {
  'use strict';
  const LESSONS = [
    {
      id: 'sowing',
      board: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
      stores: [0, 0],
      goal: { type: 'any' },
    },
    {
      id: 'capture',
      board: [3, 0, 2, 1, 0, 2, 4, 1, 3, 2, 0, 5],
      stores: [13, 12],
      goal: { type: 'capture', min: 2 },
    },
    {
      id: 'chain',
      board: [1, 2, 0, 3, 4, 1, 2, 1, 2, 4, 1, 6],
      stores: [11, 10],
      goal: { type: 'capture', min: 8 },
    },
    {
      id: 'big-pit',
      board: [17, 1, 0, 2, 0, 0, 1, 3, 0, 2, 4, 1],
      stores: [9, 8],
      goal: { type: 'capture', min: 3 },
    },
    {
      id: 'feeding',
      board: [6, 3, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0],
      stores: [18, 18],
      goal: { type: 'any' },
    },
    {
      id: 'grand-slam',
      board: [2, 0, 1, 0, 2, 2, 1, 1, 0, 0, 0, 0],
      stores: [20, 19],
      goal: { type: 'capture', min: 2 },
    },
    {
      id: 'end',
      board: [0, 0, 1, 0, 1, 3, 2, 0, 1, 2, 1, 1],
      stores: [23, 13],
      goal: { type: 'capture', min: 2 },
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = LESSONS;
  root.Awale = root.Awale || {};
  root.Awale.LESSONS = LESSONS;
})(typeof window !== 'undefined' ? window : globalThis);
