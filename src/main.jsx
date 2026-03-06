import React from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from 'boardgame.io/react';

import { TicTacToe } from './Game';
import { Board } from './Board';

const App = Client({
  game: TicTacToe,
  board: Board,
  numPlayers: 2,
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);