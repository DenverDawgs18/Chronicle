// ========== Exercise Registry ==========
// Central registry for all exercise modules.
// Maps exercise keys to their detection modules.

(function() {
  Chronicle.registry = {
    /**
     * Get an exercise module by key
     */
    get: function(key) {
      return Chronicle.exercises[key] || null;
    },

    /**
     * Get all registered exercise keys
     */
    keys: function() {
      return Object.keys(Chronicle.exercises);
    },

    /**
     * Get all exercises grouped by category
     */
    byCategory: function() {
      const categories = {};
      for (const key in Chronicle.exercises) {
        const ex = Chronicle.exercises[key];
        const cat = ex.category || 'other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
      }
      return categories;
    },

    /**
     * Get exercise display name by key
     */
    getName: function(key) {
      const ex = this.get(key);
      return ex ? ex.name : key;
    },

    /**
     * Get session name for workouts
     */
    getSessionName: function(key) {
      const ex = this.get(key);
      return ex ? ex.sessionName : 'Workout Session';
    },

    /**
     * Get all exercise names for UI display
     */
    allExercises: function() {
      return Object.keys(Chronicle.exercises).map(key => ({
        key: key,
        name: Chronicle.exercises[key].name,
        category: Chronicle.exercises[key].category,
        isSingleLeg: Chronicle.exercises[key].isSingleLeg,
      }));
    },
  };

  // Log registered exercises
  const keys = Chronicle.registry.keys();
  console.log(`Exercise registry loaded: ${keys.length} exercises [${keys.join(', ')}]`);
})();
