import type { GameStrings } from '../../i18n';

/**
 * MAGPIE HEIST copy merged over the engine tables: symbol names, the glint square / Shooting Star /
 * loot rules, the three heists and the feature spins. Engine keys overridden here that also have an
 * engine social override get their own social version below (stake.us wording: play, get, coins).
 */
export const GAME_STRINGS: GameStrings = {
  en: {
    'sym.H1': 'Jeweled Crown',
    'sym.H2': 'Jeweled Egg',
    'sym.H3': 'Pocket Watch',
    'sym.H4': 'Ruby Chalice',
    'sym.H5': 'Key Ring',
    'sym.L1': 'Ace',
    'sym.L2': 'King',
    'sym.L3': 'Queen',
    'sym.L4': 'Jack',
    'sym.L5': 'Ten',
    'sym.W': 'Bandit Mask',
    'sym.S': 'Safe',
    'sym.R': 'Shooting Star',

    'paytable.wild.desc.heist': 'The Bandit Mask is Wild: it substitutes for all paying symbols and can be part of any cluster.',
    'paytable.star.title': 'SHOOTING STAR',
    'paytable.star.desc': 'When the tumbles end with a Shooting Star on the board, every Glint Square reveals loot.',
    'paytable.safe.title': 'SAFE',
    'paytable.safe.desc': '3, 4 or 5 Safes trigger Night Prowl, Vault Raid or Starfall.',

    'rules.cascade.title': 'SUPER CASCADE',
    'rules.cascade.body':
      'Clusters of {n} or more matching symbols connected horizontally or vertically win. After a win, every symbol of the winning type explodes, not only the cluster, and new symbols fall in. This repeats as long as there are new wins.',
    'rules.glint.title': 'GLINT SQUARES',
    'rules.glint.body':
      'Every position of a winning symbol turns into a Glint Square. In the base game the Glint Squares stay until the end of the spin.',
    'rules.star.title': 'SHOOTING STAR',
    'rules.star.body':
      'When the tumbles end with a Shooting Star on the board, every Glint Square reveals a piece of loot: a coin, a Diamond or a Nest. Coin values are multiples of the bet:',
    'rules.loot.bronze': 'Bronze coin',
    'rules.loot.silver': 'Silver coin',
    'rules.loot.gold': 'Gold coin',
    'rules.loot.diamond': 'Diamond',
    'rules.loot.nest': 'Nest',
    'rules.loot.range': '{lo}× – {hi}×',
    'rules.loot.diamondValue': '×2 – ×10 to its neighbours',
    'rules.loot.nestValue': 'collects every coin',
    'rules.diamond.title': 'DIAMONDS',
    'rules.diamond.body':
      'A Diamond multiplies the coins and Nests in the 8 positions around it by its multiplier. Diamonds act before Nests.',
    'rules.nest.title': 'NESTS',
    'rules.nest.body':
      'A Nest collects the value of every coin on the board. The collected coins leave their Glint Squares, and every empty Glint Square then reveals new loot. This repeats while new Nests appear, up to {rounds} times. Finally every coin and Nest is paid.',
    'rules.prowl.title': 'NIGHT PROWL',
    'rules.prowl.body':
      '{n} Safes trigger {spins} Free Spins. Glint Squares stay from spin to spin until a Shooting Star activates them. 2 Safes award +{r2} spins and 3 Safes +{r3}. {up} Safes upgrade the feature to Vault Raid with {add} extra spins.',
    'rules.vault.title': 'VAULT RAID',
    'rules.vault.body':
      '{n} Safes trigger {spins} Free Spins. Glint Squares never reset: after a Shooting Star pays them out they stay for the rest of the feature. 2 Safes award +{r2} spins and 3 Safes +{r3}.',
    'rules.starfall.title': 'STARFALL',
    'rules.starfall.body':
      '{n} Safes trigger {spins} Free Spins. Glint Squares never reset, a Shooting Star lands on every spin and no bronze coins appear. 2 Safes award +{r2} spins and 3 Safes +{r3}.',
    'rules.featurespins.title': 'FEATURE SPINS',
    'rules.featurespins.body':
      'Bonus Hunt ({hunt}× the bet per spin) makes Safes about five times more likely. Star Spins ({stars}× the bet per spin) put a Shooting Star on every spin. Feature Spins stay on for every spin and autoplay until they are switched off.',

    'rules.modes.hunt': 'Bonus Hunt feature spins',
    'rules.modes.stars': 'Star Spins feature spins',
    'rules.modes.prowl': 'Night Prowl feature',
    'rules.modes.vault': 'Vault Raid feature',
    'rules.buy.hunt': 'Bonus Hunt costs {cost}× the bet per spin and stays active until it is switched off.',
    'rules.buy.stars': 'Star Spins cost {cost}× the bet per spin and stay active until they are switched off.',
    'rules.buy.prowl':
      'Night Prowl can be bought from the base game for {cost}× the current bet. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'rules.buy.vault':
      'Vault Raid can be bought from the base game for {cost}× the current bet. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'heist.prowl.title': 'NIGHT PROWL',
    'heist.vault.title': 'VAULT RAID',
    'heist.starfall.title': 'STARFALL',
    'heist.prowl.desc': 'GLINT SQUARES STAY UNTIL A STAR STRIKES',
    'heist.vault.desc': 'GLINT SQUARES NEVER RESET',
    'heist.starfall.desc': 'A STAR EVERY SPIN · NO BRONZE COINS',
    'heist.upgrade': 'UPGRADE!',
    'heist.loot': 'LOOT',
    'heist.stolen': 'STOLEN!',
    'heist.collect': 'NEST',
    'heist.spinsOf': '{current} / {total}',
    'heist.huntOn': 'BONUS HUNT ×{x}',
    'heist.starsOn': 'STAR SPINS ×{x}',
    'mh.logo.top': 'MAGPIE',
    'mh.logo.main': 'HEIST',
    'buy.hunt.title': 'BONUS HUNT',
    'buy.stars.title': 'STAR SPINS',
    'buy.featureSpins': 'FEATURE SPINS',
    'buy.freeSpins': 'BUY FEATURE',
    'buy.perSpin': 'SPIN',
    'buy.turnOff': 'TURN OFF',
    'buy.activate': 'ACTIVATE',
    'buy.active': 'ACTIVE',
    'buy.insufficient': 'INSUFFICIENT BALANCE',
    'buy.confirmSpin': 'EVERY SPIN COSTS',
    'buy.confirmYes': 'CONFIRM',
    'buy.cancel': 'CANCEL',
    'buy.title': 'THE HEIST BOARD',
    'buy.desc': 'Instantly trigger a feature.',
    'buy.desc.hunt': 'Safes land about five times more often.',
    'buy.desc.stars': 'A Shooting Star lands on every spin.',
    'buy.desc.prowl': 'Instantly trigger Night Prowl.',
    'buy.desc.vault': 'Instantly trigger Vault Raid.',
  },
  social: {
    'rules.buy.hunt': 'Bonus Hunt costs {cost}× the play amount per spin and stays active until it is switched off.',
    'rules.buy.stars': 'Star Spins cost {cost}× the play amount per spin and stay active until they are switched off.',
    'rules.buy.prowl':
      'Night Prowl can be instantly triggered from the base game for {cost}× the current play amount. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'rules.buy.vault':
      'Vault Raid can be instantly triggered from the base game for {cost}× the current play amount. It starts with {spins} Free Spins and plays exactly like a naturally triggered feature.',
    'rules.star.body':
      'When the tumbles end with a Shooting Star on the board, every Glint Square reveals a piece of loot: a coin, a Diamond or a Nest. Coin values are multiples of the play amount:',
    'rules.featurespins.body':
      'Bonus Hunt ({hunt}× the play amount per spin) makes Safes about five times more likely. Star Spins ({stars}× the play amount per spin) put a Shooting Star on every spin. Feature Spins stay on for every spin and autoplay until they are switched off.',
    'buy.freeSpins': 'GET FEATURE',
    'buy.confirmSpin': 'EVERY SPIN PLAYS',
    'buy.title': 'THE HEIST BOARD',
    'buy.desc': 'A feature is instantly triggered at the start of the round.',
    'buy.desc.prowl': 'Night Prowl is instantly triggered at the start of the round.',
    'buy.desc.vault': 'Vault Raid is instantly triggered at the start of the round.',
  },
};
