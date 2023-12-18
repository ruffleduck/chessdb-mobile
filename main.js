$(() => {
  const $board = $("#board");
  const $eval = $("#eval");
  const $lichessAnalysis = $("#lichess-analysis");
  const $moveList = $("#move-list");
  const $queryInfo = $("#query-info");
  const $statusDisplay = $("#status-display");
  const $masters = $("#masters");
  const $whiteSortOptions = $("#white-sort-options");
  const $blackSortOptions = $("#black-sort-options");

  const game = new Chess();
  let queryInfo;
  let sortedQueryInfo;
  let isUpdatingBoard = false;

  function convertEval(e, turn) {
    if (isNaN(e)) return "unknown";
    let evaluation = e / 100;
    if (turn === "b") evaluation *= -1;
    return ((evaluation < 0) ? "" : "+") + evaluation.toFixed(2);
  }

  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    } else {
      return num.toString();
    }
  }

  async function fetchChessDbData() {
    $statusDisplay.text("Requesting...");
    const response = await fetch(`https://www.chessdb.cn/cdb.php?action=queryall&board=${encodeURIComponent(game.fen())}`);
    const moves = await response.text();

    const uniqueMoves = new Set();
    const movesData = [];

    moves.split("|").forEach(move => {
      const moveStartIndex = move.indexOf("move:") + 5;
      const moveEndIndex = move.indexOf(",", moveStartIndex);
      const moveStr = move.substring(moveStartIndex, moveEndIndex);

      if (!uniqueMoves.has(moveStr)) {
        uniqueMoves.add(moveStr);

        let moveInfo = { move: moveStr };
        move.substring(moveEndIndex + 1).split(",").forEach(item => {
          const [key, value] = item.split(":");
          moveInfo[key] = key === "note" ? value.trim() : parseInt(value, 10);
        });
        movesData.push(moveInfo);
      }
    });

    return movesData;
  }

  async function onBoardUpdate() {
    if (isUpdatingBoard) {
      return;
    }

    isUpdatingBoard = true;

    try {
      $moveList.text("");
      const moveHistory = game.history();
      for (let i = 0; i < moveHistory.length; i += 2) {
        $moveList.append(`<p>${Math.ceil((i + 1) / 2)}. ${moveHistory[i]} ${(i + 1) < moveHistory.length ? moveHistory[i + 1] : ""}</p>`);
      }
      $moveList.scrollTop($moveList.prop("scrollHeight"));

      $lichessAnalysis.attr("href", `https://lichess.org/analysis/fromPosition/${game.fen()}`);

      try {
        queryInfo = await fetchChessDbData();
      } catch (error) {
        console.error("Error fetching ChessDB data:", error);
      }

      $eval.text("eval: " + convertEval(queryInfo[0]?.score, game.turn()));

      let explorerInfo;
      if($masters.is(":checked"))
        explorerInfo = await fetch(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(game.fen())}`)
        .then(response => response.json());
      else
        explorerInfo = await fetch(`https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(game.fen())}&speeds=blitz,rapid&ratings=2000,2200,2500`)
        .then(response => response.json());

      let white = explorerInfo.white;
      let draws = explorerInfo.draws;
      let total = white + draws + explorerInfo.black;
      let winrate = ((white / total + 0.5 * draws / total) * 100).toFixed(1);
      $statusDisplay.text(isNaN(winrate) ? "n/a" : `${winrate}% winrate, ${formatNumber(total)} games`);

      for (let i = 0; i < queryInfo.length; i++) {
        const tempGame = new Chess();
        tempGame.load(game.fen());
        tempGame.move({ from: queryInfo[i].move.substring(0, 2), to: queryInfo[i].move.substring(2, 4) });
        const moveSan = tempGame.history()[tempGame.history().length - 1];
        winrate = NaN;
        total = NaN;
        if (moveSan !== undefined) {
          for (let j = 0; j < explorerInfo.moves.length; j++) {
            if (explorerInfo.moves[j].san === moveSan) {
              white = explorerInfo.moves[j].white;
              draws = explorerInfo.moves[j].draws;
              total = white + draws + explorerInfo.moves[j].black;
              winrate = ((white / total + 0.5 * draws / total) * 100).toFixed(1);
              break;
            }
          }
        }
        queryInfo[i].total = total;
        queryInfo[i].winrate = winrate;
        queryInfo[i].moveSan = moveSan;
      }

      $queryInfo.text("");

      sortedQueryInfo = queryInfo.map(obj => ({ ...obj }));
      sortedQueryInfo.sort((a, b) => {
        let aComparisonValue;
        let bComparisonValue;
        switch (game.turn() === "w" ? $whiteSortOptions.val() : $blackSortOptions.val()) {
          case "accuracy":
            aComparisonValue = a.score;
            bComparisonValue = b.score;
            break;
          case "popularity":
            aComparisonValue = a.total;
            bComparisonValue = b.total;
            break;
          case "winrate":
            aComparisonValue = a.winrate;
            bComparisonValue = b.winrate;
            break;
        }
        if (isNaN(aComparisonValue) && isNaN(bComparisonValue)) return 1;
        if (isNaN(aComparisonValue)) return 1;
        if (isNaN(bComparisonValue)) return -1;
        if (aComparisonValue === bComparisonValue) return b.total - a.total;
        if (game.turn() === "b" && $blackSortOptions.val() === "winrate") return aComparisonValue - bComparisonValue;
        return bComparisonValue - aComparisonValue;
      });

      for (let i = 0; i < sortedQueryInfo.length; i++) {
        if (sortedQueryInfo[i].moveSan === undefined) continue;
        $queryInfo.append(`<p>${sortedQueryInfo[i].moveSan}${sortedQueryInfo[i].note[0]}
            (${convertEval(sortedQueryInfo[i].score, game.turn())},
            ${isNaN(sortedQueryInfo[i].winrate) ? "n/a" : `${sortedQueryInfo[i].winrate}%, `}${isNaN(sortedQueryInfo[i].total) ? "" : `${formatNumber(sortedQueryInfo[i].total)}`})</p>`);
      }
    } finally {
      isUpdatingBoard = false;
    }
  }

  const board = Chessboard("board", {
    draggable: true,
    showNotation: false,
    position: "start",
    moveSpeed: 15,
    snapbackSpeed: 0,
    snapSpeed: 0,
    onDrop: async function (source, target) {
      if (game.move({ from: source, to: target, promotion: "q" }) === null) return "snapback";
      await onBoardUpdate();
    },
    onSnapEnd: () => {
      board.position(game.fen());
    }
  });
  $(window).resize(board.resize);

  $(document).keydown(event => {
    if (isUpdatingBoard) {
      return;
    }

    setTimeout(() => {
      if (event.which === 37) {
        game.undo();
        board.position(game.fen());
      } else if (event.key === "f") {
        board.flip();
      } else if (event.which === 39) {
        if (sortedQueryInfo[0] !== undefined) {
          game.move({ from: sortedQueryInfo[0].move.substring(0, 2), to: sortedQueryInfo[0].move.substring(2, 4) });
          board.position(game.fen());
          onBoardUpdate();
        }
      }
    }, 0);
  });

  $(document).keyup(event => {
    if (event.which === 37) {
      onBoardUpdate();
    };
  });

  $eval.text("eval: +0.00");
  $lichessAnalysis.text("lichess analysis");
  onBoardUpdate();
});
