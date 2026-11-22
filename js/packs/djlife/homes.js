// DJ Life: where you live. Rent is due every Sunday. Bigger places let you host your own nights. Data only.
//
//   rent     per week
//   deposit  paid once when you move in (moving home to your parents' is always free)
//   decor    how many decor pieces fit
//   host     can you throw parties here? guests = how many fit
//   fans     new fans a week from mixtapes you record here (needs a decent laptop… or just this room)

export const HOMES = [
  { id: 'parents', name: 'Bedroom at your parents\'', rent: 0, deposit: 0, decor: 2, host: false, guests: 0, fans: 0,
    blurb: 'Free, and there\'s always food. Practise here.' },
  { id: 'flat', name: 'Shared flat', rent: 40, deposit: 80, decor: 3, host: true, guests: 20, fans: 0,
    blurb: 'Your own room and a living room for house parties.' },
  { id: 'studio', name: 'Studio flat', rent: 90, deposit: 180, decor: 4, host: true, guests: 30, fans: 6,
    blurb: 'Room for a proper booth. Record mixtapes that win fans every week.' },
  { id: 'loft', name: 'Warehouse loft', rent: 180, deposit: 360, decor: 5, host: true, guests: 80, fans: 12,
    blurb: 'Bare bricks and high ceilings. Throw your own club nights.' },
  { id: 'house', name: 'Studio house', rent: 350, deposit: 700, decor: 6, host: true, guests: 150, fans: 25,
    blurb: 'Your own studio and label. The dream.' },
];

export const homeById = (id) => HOMES.find((h) => h.id === id) || HOMES[0];
export const homeIndex = (id) => Math.max(0, HOMES.findIndex((h) => h.id === id));
