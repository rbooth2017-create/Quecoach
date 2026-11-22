// DJ Life: everything you can buy. Gear never changes the mixing itself (your beats are as matched as you make
// them); it changes how the crowd feels, which gigs will have you, and how your room looks. Data only.
//
// Effects (all small on purpose, so a great mix on cheap gear still beats a bad mix on expensive gear):
//   lift   the crowd warms up faster when the mix is good (0.10 = 10 % faster)
//   focus  mistakes upset the crowd a bit less (0.10 = 10 % slower to drop)
//   rep    extra reputation after a good gig
//   where  'all' works at every gig; 'home' only at your own place and the parties you host

export const SLOTS = [
  { id: 'controller', name: 'Controller', blurb: 'What you play on. Bigger venues expect proper kit.' },
  { id: 'headphones', name: 'Headphones', blurb: 'Hear the next song clearly: fewer slips reach the crowd.' },
  { id: 'speakers', name: 'Speakers', blurb: 'For your place and the parties you host.' },
  { id: 'lights', name: 'Lights', blurb: 'Light up your room: parties at yours get going faster.' },
  { id: 'outfit', name: 'Look', blurb: 'Look the part: a little extra reputation after good gigs.' },
  { id: 'decor', name: 'Decor', blurb: 'Make your room yours. Each home has a few spots for these.' },
];

export const GEAR = [
  // controllers (tier decides which venues book you)
  { id: 'ctl-toy', slot: 'controller', tier: 0, name: 'Toy controller', price: 0, lift: 0, blurb: 'Plastic, but it works.' },
  { id: 'ctl-starter', slot: 'controller', tier: 1, name: 'Starter 2-deck', price: 120, lift: 0.03, blurb: 'Real jog wheels. Bars will book you with this.' },
  { id: 'ctl-club', slot: 'controller', tier: 2, name: 'Club 2-deck', price: 450, lift: 0.06, blurb: 'Solid and roadworthy. Clubs take you seriously.' },
  { id: 'ctl-four', slot: 'controller', tier: 3, name: '4-deck flagship', price: 1400, lift: 0.1, blurb: 'The big one. Headliners play on this.' },
  // headphones
  { id: 'hp-buds', slot: 'headphones', tier: 0, name: 'Earbuds', price: 0, focus: 0, blurb: 'They came with your phone.' },
  { id: 'hp-basic', slot: 'headphones', tier: 1, name: 'Basic DJ headphones', price: 40, focus: 0.05, blurb: 'One ear on, one ear off.' },
  { id: 'hp-studio', slot: 'headphones', tier: 2, name: 'Studio headphones', price: 150, focus: 0.1, blurb: 'Every kick drum, crystal clear.' },
  { id: 'hp-pro', slot: 'headphones', tier: 3, name: 'Pro club headphones', price: 380, focus: 0.15, blurb: 'Loud enough for the main room.' },
  // speakers (home)
  { id: 'spk-laptop', slot: 'speakers', tier: 0, name: 'Laptop speakers', price: 0, lift: 0, where: 'home', blurb: 'Tinny.' },
  { id: 'spk-desk', slot: 'speakers', tier: 1, name: 'Desk monitors', price: 90, lift: 0.06, where: 'home', blurb: 'Your first real speakers.' },
  { id: 'spk-studio', slot: 'speakers', tier: 2, name: 'Studio monitors', price: 320, lift: 0.12, where: 'home', blurb: 'Big, clean and loud.' },
  // lights (home)
  { id: 'lt-lamp', slot: 'lights', tier: 0, name: 'Desk lamp', price: 0, lift: 0, where: 'home', blurb: 'It\'s a lamp.' },
  { id: 'lt-led', slot: 'lights', tier: 1, name: 'LED strip', price: 25, lift: 0.04, where: 'home', blurb: 'Pink and blue, all round the room.' },
  { id: 'lt-heads', slot: 'lights', tier: 2, name: 'Moving heads', price: 220, lift: 0.08, where: 'home', blurb: 'Beams that sweep in time.' },
  { id: 'lt-laser', slot: 'lights', tier: 3, name: 'Laser show', price: 600, lift: 0.12, where: 'home', blurb: 'Your place is a club now.' },
  // look
  { id: 'fit-hoodie', slot: 'outfit', tier: 0, name: 'Old hoodie', price: 0, rep: 0, blurb: 'Comfy.' },
  { id: 'fit-tee', slot: 'outfit', tier: 1, name: 'Logo tee', price: 30, rep: 1, blurb: 'Your DJ name on your chest.' },
  { id: 'fit-stage', slot: 'outfit', tier: 2, name: 'Stage look', price: 160, rep: 2, blurb: 'People remember you.' },
  // decor (looks only; each home has a few spots)
  { id: 'dec-poster', slot: 'decor', name: 'Gig poster', price: 10, blurb: 'Your first gig, framed.' },
  { id: 'dec-plant', slot: 'decor', name: 'Big plant', price: 20, blurb: 'Every booth needs one.' },
  { id: 'dec-shelf', slot: 'decor', name: 'Record shelf', price: 60, blurb: 'Crates of vinyl, wall to wall.' },
  { id: 'dec-neon', slot: 'decor', name: 'Neon sign', price: 90, blurb: 'Your name, glowing.' },
  { id: 'dec-disco', slot: 'decor', name: 'Disco ball', price: 45, blurb: 'Obviously.' },
  { id: 'dec-sofa', slot: 'decor', name: 'Comfy sofa', price: 120, blurb: 'For the after-party.' },
];

/** The kit you start with (free, already yours). */
export const STARTER_KIT = GEAR.filter((g) => g.price === 0).map((g) => g.id);

export const gearById = (id) => GEAR.find((g) => g.id === id) || null;
export const gearInSlot = (slot) => GEAR.filter((g) => g.slot === slot);
