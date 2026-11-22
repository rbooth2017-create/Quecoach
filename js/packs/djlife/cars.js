// DJ Life: the car showroom. Without a car you get the bus (or a taxi with all your kit) to every gig away from home.
// A car cuts the travel cost, and a flash one turns heads when you pull up. Data only.
//
//   travel  how much of the travel cost you still pay (1 = all of it, 0 = none)
//   rep     extra reputation after a good gig (arriving in style)
//   body    the colour it's drawn in

export const CARS = [
  { id: 'car-scooter', name: 'Second-hand scooter', price: 250, travel: 0.5, rep: 0, body: '#22d3ee',
    blurb: 'Your headphones fit under the seat. Just.' },
  { id: 'car-hatch', name: 'Little hatchback', price: 1200, travel: 0.25, rep: 0, body: '#facc15',
    blurb: 'Controller in the boot, speakers on the back seat.' },
  { id: 'car-van', name: 'DJ van', price: 2600, travel: 0, rep: 1, body: '#f4f0ff',
    blurb: 'Your whole rig fits. Your name on the side.' },
  { id: 'car-sports', name: 'Sports car', price: 9000, travel: 0, rep: 3, body: '#f472b6',
    blurb: 'Pull up to the main room and everyone notices.' },
];

export const carById = (id) => CARS.find((c) => c.id === id) || null;
