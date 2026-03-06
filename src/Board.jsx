export function Board({ G, ctx, moves }) {
  const winner = ctx.gameover?.winner;
  const draw = ctx.gameover?.draw;

  let status = `Current player: ${ctx.currentPlayer}`;
  if (winner) status = `Winner: ${winner}`;
  if (draw) status = `Draw`;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '24px' }}>
      <h1>Tic-Tac-Toe</h1>
      <p>{status}</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 80px)',
          gap: '8px',
        }}
      >
        {G.cells.map((cell, i) => (
          <button
            key={i}
            onClick={() => moves.clickCell(i)}
            disabled={!!ctx.gameover}
            style={{
              width: '80px',
              height: '80px',
              fontSize: '28px',
              cursor: 'pointer',
            }}
          >
            {cell === '0' ? 'X' : cell === '1' ? 'O' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}