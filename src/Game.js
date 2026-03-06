export const TicTacToe = {
  name: 'tic-tac-toe',

  setup: () => ({
    cells: Array(9).fill(null),
  }),

  turn: {
    minMoves: 1,
    maxMoves: 1,
  },

  moves: {
    clickCell: ({ G, ctx }, id) => {
      if (G.cells[id] !== null) return;
      G.cells[id] = ctx.currentPlayer;
    },
  },

  endIf: ({ G }) => {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const [a, b, c] of lines) {
      if (G.cells[a] && G.cells[a] === G.cells[b] && G.cells[a] === G.cells[c]) {
        return { winner: G.cells[a] };
      }
    }

    if (G.cells.every(cell => cell !== null)) {
      return { draw: true };
    }
  },
};