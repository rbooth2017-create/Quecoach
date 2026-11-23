# Drawing your own art for DJ Life

Everything in the room starts as simple shapes drawn in code. You can replace any of them with your own picture.

1. Draw it and save it as a **.png with a see-through background** in this folder.
2. Give it one of the names below, for example `bed.png`.
3. Open `art.js` in this folder and add the name to the list: `export const ART = ['bed'];`
4. Reload the app. Your picture is used instead of the shape.

## How pictures are placed

The room is isometric: every floor tile is a diamond **64 px wide and 32 px tall**. Draw things from that angle:
the front corner of the thing points down at you.

- The picture is **stretched to the width of the thing's floor space** and keeps its shape (so draw it the right width
  and height ratio, and the height can be anything).
- The **bottom middle of the picture** sits on the **front corner** of the floor space. Leave no empty space at the
  bottom of the picture.

| Name | What it is | Floor space | Picture width |
|---|---|---|---|
| `dj` | You! Drawn facing down-right; it's flipped to face left | one tile | about 40 px wide, 70 px tall |
| `bed` | Bed | 2 × 3 tiles | 160 px |
| `booth` | Desk with your decks | 2 × 1 | 96 px |
| `booth-1`, `booth-2`, `booth-3` | The desk with better controllers (Starter, Club, Flagship) | 2 × 1 | 96 px |
| `laptop` | Laptop on a little table | 1 × 1 | 64 px |
| `wardrobe` | Wardrobe | 1 × 1 | 64 px |
| `speaker`, `speaker-1`, `speaker-2` | Speakers | 1 × 1 | 64 px |
| `plant` | Big plant | 1 × 1 | 64 px |
| `shelf` | Record shelf | 2 × 1 | 96 px |
| `sofa` | Sofa | 2 × 1 | 96 px |
| `poster` | Gig poster (hangs on the wall) | | about 32 × 40 px |
| `person` | Someone in the crowd at a venue (drawn facing right) | one tile | about 34 px wide, 58 px tall |

### In town

| Name | What it is | Floor space | Picture width |
|---|---|---|---|
| `building-home` | Your home from the street | 5 × 6 | 352 px |
| `building-estate` | Keys & Co, the estate agent | 3 × 4 | 224 px |
| `building-gear` | Deck Dept, the DJ gear shop | 4 × 5 | 288 px |
| `building-clothes` | Thread, the clothes shop | 3 × 4 | 224 px |
| `building-decor` | Home & Glow | 3 × 4 | 224 px |
| `building-cars` | Wheels, the car showroom | 4 × 5 | 288 px |
| `building-party` | Sam's house | 5 × 6 | 352 px |
| `building-basement` | The Basement | 5 × 6 | 352 px |
| `building-warehouse` | Warehouse | 8 × 9 | 544 px |
| `building-main` | The Dome | 9 × 10 | 608 px |
| `tree`, `lamp` | Trees and street lamps | 1 × 1 | 64 px |
| `car-scooter`, `car-hatch`, `car-van`, `car-sports` | Your car on the drive (parked along the street) | 2 × 1 | 96 px |

A building picture replaces the whole building, including its sign, so draw the name on it.

Tip: start with `dj.png`. It's the one you'll see the most.
