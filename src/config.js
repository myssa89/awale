/*
 * Feature switches.
 * premium: puzzles tab and "Copy games for analysis". On for local development and the private
 * preview; build.js turns it off in site/ (the public Netlify version).
 */
(function (root) {
  'use strict';
  root.Awale = root.Awale || {};
  root.Awale.CONFIG = { premium: true };
})(typeof window !== 'undefined' ? window : globalThis);
