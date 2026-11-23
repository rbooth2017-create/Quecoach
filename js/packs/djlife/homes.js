// DJ Life: where you live. Rent one (rent every Sunday, a deposit to move in) or buy it outright (no more rent, and
// it's yours for good). The two biggest places are only for sale. Data only.
//
//   rent     per week (null: not to rent, buy it)
//   deposit  paid once when you move in to rent (moving home to your parents' is always free)
//   price    to buy it
//   decor    how many decor pieces fit
//   host     can you throw parties here? guests = how many fit
//   fans     new fans a week from mixtapes you record here
//   street   the house number on the town map, for the estate agent's window

export const HOMES = [
  { id: 'parents', name: 'Bedroom at your parents\'', rent: 0, deposit: 0, price: 0, decor: 2, host: false, guests: 0, fans: 0,
    blurb: 'Free, and there\'s always food. Practise here.' },
  { id: 'flat', name: 'Shared flat', rent: 40, deposit: 80, price: 1500, decor: 3, host: true, guests: 20, fans: 0,
    blurb: 'Your own room and a living room for house parties.' },
  { id: 'studio', name: 'Studio flat', rent: 90, deposit: 180, price: 3500, decor: 4, host: true, guests: 30, fans: 6,
    blurb: 'Room for a proper booth. Record mixtapes that win fans every week.' },
  { id: 'loft', name: 'Warehouse loft', rent: 180, deposit: 360, price: 7000, decor: 5, host: true, guests: 80, fans: 12,
    blurb: 'Bare bricks and high ceilings. Throw your own club nights.' },
  { id: 'house', name: 'Studio house', rent: 350, deposit: 700, price: 14000, decor: 6, host: true, guests: 150, fans: 25,
    blurb: 'Your own studio and label. The dream.' },
  { id: 'penthouse', name: 'Penthouse', rent: null, deposit: null, price: 25000, decor: 7, host: true, guests: 220, fans: 40,
    blurb: 'Top floor, glass walls, the whole city lit up below you.' },
  { id: 'mansion', name: 'Mansion', rent: null, deposit: null, price: 50000, decor: 8, host: true, guests: 400, fans: 70,
    blurb: 'A pool, a club in the basement, and a gate with your name on it.' },
];

export const homeById = (id) => HOMES.find((h) => h.id === id) || HOMES[0];
export const homeIndex = (id) => Math.max(0, HOMES.findIndex((h) => h.id === id));
