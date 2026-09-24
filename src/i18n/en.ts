/**
 * English strings (the reference table — other languages fall back to it key by key).
 * Placeholders use {name}; t(key, vars) fills them. Numbers/money are formatted by the
 * caller (ctx.money) before they reach t().
 */
export const EN: Record<string, string> = {
  // ── HUD ────────────────────────────────────────────────────────────────
  balance: 'BALANCE',
  bet: 'BET',
  betSize: 'BET SIZE',
  win: 'WIN',
  totalWin: 'TOTAL WIN',
  freeSpins: 'FREE SPINS',
  bonusBuy: 'BONUS BUY',
  spin: 'SPIN',
  replay: 'REPLAY',
  autoplay: 'AUTOPLAY',
  turbo: 'TURBO',
  menu: 'MENU',
  stop: 'STOP',
  skip: 'SKIP',
  'hud.buyShort': 'BUY',
  'hud.fsOf': '{current}/{total}',
  'hud.autoLeft': '{n}',
  // presentation overlays (present/*: label(key, fallback))
  'fs.summary': '{n} FREE SPINS',
  tapToContinue: 'TAP TO CONTINUE',
  'bigwin.big': 'BIG WIN',
  'bigwin.super': 'SUPER WIN',
  'bigwin.mega': 'MEGA WIN',
  'bigwin.epic': 'EPIC WIN',
  'bigwin.max': 'MAX WIN',
  'turbo.normal': 'NORMAL',
  'turbo.turbo': 'TURBO',
  'turbo.superTurbo': 'SUPER TURBO',

  // ── common ─────────────────────────────────────────────────────────────
  close: 'Close',
  ok: 'OK',
  cancel: 'CANCEL',
  reload: 'RELOAD',
  on: 'ON',
  off: 'OFF',
  infinite: '∞',

  // ── menu shell ─────────────────────────────────────────────────────────
  'menu.title': 'GAME INFO',
  'menu.paytable': 'PAYTABLE',
  'menu.rules': 'RULES',
  'menu.guide': 'UI GUIDE',
  'menu.settings': 'SETTINGS',

  // ── paytable ───────────────────────────────────────────────────────────
  'paytable.intro':
    'Clusters of 5 or more identical symbols connected horizontally or vertically pay. Values are multiples of the bet for each cluster size.',
  'paytable.symbols': 'SYMBOL PAYS',
  'paytable.specials': 'SPECIAL SYMBOLS',
  'paytable.spots': 'MULTIPLIER SPOTS',
  'paytable.size': 'Cluster',
  'paytable.pending': 'Pay values are supplied by the certified math model of this game version.',
  'paytable.wild.title': 'WILD',
  'paytable.wild.desc': 'Substitutes for all paying symbols and can be part of any cluster. Wilds do not form clusters on their own.',
  'paytable.scatter.title': 'SCATTER',
  'paytable.scatter.desc': '{min} or more Scatters anywhere on the grid trigger Free Spins. Scatters do not form clusters.',
  'paytable.spots.desc':
    'Every exploding winning symbol marks its spot. Further explosions on a marked spot raise its multiplier. Multipliers under a winning cluster are added together and applied to that cluster win.',
  'paytable.spots.marked': 'MARKED',
  'paytable.kind.high': 'HIGH',
  'paytable.kind.royal': 'LOW',

  // ── symbols (fallback: SYMBOLS[id].label) ─────────────────────────────
  'sym.H1': 'Golden Boombox',
  'sym.H2': 'Vinyl Record',
  'sym.H3': 'Crawfish',
  'sym.H4': 'Hot Sauce',
  'sym.L1': 'Ace',
  'sym.L2': 'King',
  'sym.L3': 'Queen',
  'sym.L4': 'Jack',
  'sym.L5': 'Ten',
  'sym.W': 'Wild',
  'sym.S': 'Golden Mic',

  // ── rules ──────────────────────────────────────────────────────────────
  'rules.overview.title': 'OVERVIEW',
  'rules.overview.body':
    '{title} is played on a grid of 7 reels and 5 rows. Wins are awarded for clusters of identical symbols. All wins are multiplied by the bet.',
  'rules.cluster.title': 'CLUSTER PAYS',
  'rules.cluster.body':
    'A cluster is 5 or more identical symbols connected horizontally or vertically. Diagonal connections do not count. Only the highest win per cluster is paid. Simultaneous wins on different clusters are added together.',
  'rules.tumble.title': 'TUMBLE FEATURE',
  'rules.tumble.body':
    'After every win the winning symbols explode and are removed. The remaining symbols fall down and new symbols drop in from above to fill the gaps. Tumbling continues for as long as new winning clusters appear. All wins of a tumble sequence are added together.',
  'rules.spots.title': 'MULTIPLIER SPOTS',
  'rules.spots.body':
    'When a winning symbol explodes, its position on the grid is marked. Every further explosion on a marked spot increases its multiplier, up to x{maxSpot}. If a winning cluster covers multiplier spots, their values are added together and the cluster win is multiplied by the total. {spotReset}',
  'rules.spots.reset':
    'Spots are cleared at the end of every base game round and stay in place for the whole Free Spins feature.',
  'rules.wild.title': 'WILD',
  'rules.wild.body': 'The Wild substitutes for all paying symbols. It does not substitute for Scatters.',
  'rules.fs.title': 'FREE SPINS',
  'rules.fs.body':
    'Landing {min} or more Scatters anywhere on the grid triggers Free Spins. The number of Free Spins awarded depends on the number of Scatters:',
  'rules.fs.row': '{n} Scatters',
  'rules.fs.award': '{spins} Free Spins',
  'rules.fs.retrigger':
    'During the feature, {min} or more Scatters award additional Free Spins. Free Spins are played at the bet of the triggering round.',
  'rules.buy.title': 'BONUS BUY',
  'rules.buy.body':
    'The Free Spins feature can be bought from the base game for {cost}× the current bet. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
  'rules.maxWin.title': 'MAXIMUM WIN',
  'rules.maxWin.body':
    'The maximum win is {maxWin}× the bet per round in every game mode. When it is reached, the round ends immediately and the maximum win is awarded.',
  'rules.rtp.title': 'RETURN TO PLAYER',
  'rules.rtp.body': 'The theoretical return to player (RTP) of each game mode is listed below. It is calculated over a very large number of rounds.',
  'rules.modes.title': 'GAME MODES',
  'rules.modes.mode': 'MODE',
  'rules.modes.cost': 'COST',
  'rules.modes.rtp': 'RTP',
  'rules.modes.maxWin': 'MAX WIN',
  'rules.modes.base': 'Base game',
  'rules.modes.bonus': 'Free Spins feature',
  'rules.modes.costX': '{x}×',
  'rules.more.title': 'MORE INFORMATION',
  'rules.more.turbo': 'Turbo and Super Turbo only speed up the animations. Outcomes are never affected.',
  'rules.more.autoplay': 'Autoplay plays a chosen number of rounds automatically and always needs a confirmation to start.',
  'rules.more.keys': 'Press SPACE or ENTER to spin.',
  'rules.more.resume': 'An interrupted round is resumed automatically the next time the game is opened.',
  'rules.disclaimer.title': 'DISCLAIMER',
  'rules.disclaimer.body':
    'Malfunction voids all pays and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser.',
  'rules.copyright': '{title}™ and © {year} {holder}. All rights reserved.',
  'rules.version': 'Game version {version}',

  // ── UI guide ───────────────────────────────────────────────────────────
  'guide.intro': 'What every button does.',
  'guide.spin.title': 'SPIN',
  'guide.spin.desc':
    'Starts a round at the current bet. While symbols are moving, press again to skip ahead. Keyboard: SPACE or ENTER.',
  'guide.autoplay.title': 'AUTOPLAY',
  'guide.autoplay.desc':
    'Opens the autoplay settings: choose the number of rounds and optional stop limits, then confirm with START. While autoplay runs, the Spin button shows the rounds left; press it to stop.',
  'guide.turbo.title': 'TURBO',
  'guide.turbo.desc': 'Switches the animation speed between Normal, Turbo and Super Turbo (more bolts = faster). Outcomes are not affected.',
  'guide.bet.title': 'BET − / +',
  'guide.bet.desc': 'Lowers or raises the bet. Every available bet level can be selected.',
  'guide.buy.title': 'BONUS BUY',
  'guide.buy.desc': 'Buys the Free Spins feature directly for a fixed multiple of the bet. A confirmation is always shown first.',
  'guide.menu.title': 'MENU',
  'guide.menu.desc': 'Opens the paytable, the game rules, this guide and the settings.',
  'guide.balance.title': 'BALANCE',
  'guide.balance.desc': 'Your current balance.',
  'guide.win.title': 'WIN',
  'guide.win.desc': 'The win of the current round. It counts up as tumbles and multipliers add to the total.',
  'guide.sound.title': 'SOUND',
  'guide.sound.desc': 'Music and sound effects can be switched off in Settings.',

  // ── settings ───────────────────────────────────────────────────────────
  'settings.sound': 'Sound',
  'settings.sound.desc': 'Music and sound effects',
  'settings.turbo': 'Game speed',
  'settings.turbo.desc': 'Faster animations. Outcomes are not affected.',
  'settings.turbo.locked': 'Not available in your region.',
  'settings.intro': 'Skip intro screen',
  'settings.intro.desc': 'Go straight to the game on the next launch',
  'settings.keys': 'Press SPACE or ENTER to spin.',

  // ── autoplay dialog ────────────────────────────────────────────────────
  'autoplay.title': 'AUTOPLAY',
  'autoplay.rounds': 'NUMBER OF ROUNDS',
  'autoplay.lossLimit': 'LOSS LIMIT',
  'autoplay.lossLimitHint': 'Stop when the balance drops by',
  'autoplay.winLimit': 'SINGLE WIN LIMIT',
  'autoplay.winLimitHint': 'Stop when a single win reaches',
  'autoplay.start': 'START AUTOPLAY',
  'autoplay.startN': 'START {n} ROUNDS',
  'autoplay.note': 'Autoplay stops when a limit is reached or when you press the Spin button.',

  // ── bonus buy confirm ──────────────────────────────────────────────────
  'buy.title': 'BUY FREE SPINS',
  'buy.desc': 'Instantly trigger the Free Spins feature.',
  'buy.costLabel': 'COST',
  'buy.multiple': '{x}× the current bet',
  'buy.confirm': 'BUY',

  // ── errors / messages ──────────────────────────────────────────────────
  'error.title': 'SOMETHING WENT WRONG',
  'error.generic': 'An unexpected error occurred. Please reload the game.',
  'err.ERR_VAL': 'The request was not valid. Please reload the game.',
  'err.ERR_IPB': 'Insufficient balance. Lower the bet to continue.',
  'err.ERR_IS': 'Your session has expired. Please reload the game.',
  'err.ERR_ATE': 'Authentication failed. Please reload the game.',
  'err.ERR_GLE': 'A gambling limit has been reached.',
  'err.ERR_LOC': 'The game is not available in your location.',
  'err.ERR_GEN': 'A server error occurred. Please try again.',
  'err.ERR_MAINTENANCE': 'The game is under maintenance. Please try again later.',
  'err.NETWORK': 'Connection lost. Check your internet connection and reload the game.',

  // ── replay ─────────────────────────────────────────────────────────────
  'replay.start': 'START REPLAY',
  'replay.again': 'PLAY AGAIN',
  'replay.cost': '{mode} · BET {bet} · {real} REAL COST',
  'replay.loading': 'Loading replay…',
  'replay.notFound': 'This replay could not be found.',
};
