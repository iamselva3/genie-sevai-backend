/* Demo catalogue. Prices are in INR. */

export const CITIES = [
  { name: 'Chennai', slug: 'chennai', state: 'Tamil Nadu', isActive: true },
  { name: 'Coimbatore', slug: 'coimbatore', state: 'Tamil Nadu', isActive: true },
  { name: 'Madurai', slug: 'madurai', state: 'Tamil Nadu', isActive: true },
  { name: 'Bengaluru', slug: 'bengaluru', state: 'Karnataka', isActive: true },
  { name: 'Hyderabad', slug: 'hyderabad', state: 'Telangana', isActive: true },
  { name: 'Salem', slug: 'salem', state: 'Tamil Nadu', isActive: false },
];

type S = [name: string, price: number, mrp: number, minutes: number, extra?: Partial<SeedService>];

export interface SeedService {
  name: string;
  group: string;
  price: number;
  mrp: number;
  durationMinutes: number;
  shortDescription: string;
  inclusions: string[];
  exclusions: string[];
  isPopular: boolean;
  status: 'active' | 'unavailable' | 'hidden';
  unavailableReason: string;
  cities: string[];
}

export interface SeedCategory {
  name: string;
  slug: string;
  icon: string;
  tagline: string;
  description: string;
  groups: Record<string, S[]>;
  inclusions: string[];
}

export const CATEGORIES: SeedCategory[] = [
  {
    name: 'Salon for Women',
    slug: 'salon-women',
    icon: 'sparkles',
    tagline: 'Salon-grade care, in your living room',
    description: 'Certified beauticians with single-use kits, hospital-grade hygiene and branded products.',
    inclusions: ['Single-use, sealed kits', 'Branded products only', 'Mess-free setup and cleanup'],
    groups: {
      Waxing: [
        ['Full arms & underarms (Rica)', 499, 599, 45],
        ['Full legs waxing (Rica)', 599, 699, 45],
        ['Full body waxing (Rica)', 1599, 1999, 120, { isPopular: true }],
      ],
      'Facial & cleanup': [
        ['O3+ shine & glow facial', 1499, 1799, 75, { isPopular: true }],
        ['Fruit cleanup', 599, 699, 40],
        ['Hydra-boost facial', 1899, 2299, 80],
      ],
      'Mani & pedi': [['Classic mani-pedi combo', 899, 1099, 90]],
      Hair: [
        ['Hair spa (shoulder length)', 999, 1199, 60],
        ['Blow-dry & styling', 699, 0, 45],
      ],
    },
  },
  {
    name: "Men's Grooming",
    slug: 'grooming-men',
    icon: 'scissors',
    tagline: 'Barber-quality cuts, zero queue',
    description: 'Trained barbers who bring the chair-side experience home, including cleanup.',
    inclusions: ['Sanitised tools', 'Disposable neck strips & sheets', 'Floor cleanup after service'],
    groups: {
      Haircut: [
        ['Haircut + beard styling', 399, 499, 45, { isPopular: true }],
        ['Kids haircut', 249, 0, 30],
      ],
      'Face care': [
        ['Charcoal de-tan cleanup', 549, 649, 40],
        ['Anti-ageing facial', 1299, 1499, 60],
      ],
      Massage: [['Head & shoulder massage (30 min)', 449, 0, 30]],
      Colour: [['Hair colour (ammonia-free)', 699, 799, 45]],
    },
  },
  {
    name: 'Home Cleaning',
    slug: 'cleaning',
    icon: 'spray-can',
    tagline: 'Deep clean you can actually see',
    description: 'Machine-assisted deep cleaning with safe chemicals. Our crew brings every tool.',
    inclusions: ['Machines, chemicals & tools included', 'Child & pet-safe chemicals', 'Background-verified crew'],
    groups: {
      Bathroom: [
        ['Bathroom deep cleaning', 499, 599, 60, { isPopular: true }],
        ['2 bathrooms combo', 899, 1198, 110],
      ],
      Kitchen: [
        ['Kitchen deep cleaning', 1299, 1499, 150],
        ['Chimney & hob cleaning', 799, 899, 60],
      ],
      'Full home': [
        ['Full home deep cleaning (2 BHK)', 3999, 4999, 300, { isPopular: true }],
        ['Move-in cleaning (1 BHK)', 2999, 3499, 240],
      ],
      'Sofa & carpet': [
        ['Sofa shampooing (5 seats)', 899, 1099, 90, { status: 'unavailable', unavailableReason: 'Machines are being serviced. Back soon.' }],
        ['Carpet shampooing (up to 50 sq.ft)', 699, 0, 60],
      ],
    },
  },
  {
    name: 'AC Service & Repair',
    slug: 'ac-repair',
    icon: 'air-vent',
    tagline: 'Cool again within the hour',
    description: 'Foam-jet servicing, gas refills and installation by certified technicians with a 30-day warranty.',
    inclusions: ['30-day service warranty', 'Transparent spare-part rate card', 'Post-service cleanup'],
    groups: {
      Service: [
        ['Foam-jet AC service (split)', 599, 699, 60, { isPopular: true }],
        ['Foam-jet AC service (window)', 549, 649, 60],
      ],
      Repair: [
        ['AC not cooling check-up', 299, 0, 45],
        ['Gas refill & leak fix', 2499, 2999, 120],
      ],
      Installation: [
        ['Split AC installation', 1499, 1799, 120],
        ['AC uninstallation', 699, 0, 60],
      ],
    },
  },
  {
    name: 'Appliance Repair',
    slug: 'appliances',
    icon: 'washing-machine',
    tagline: 'Fixed at home, with a warranty',
    description: 'Diagnosis and repair for everyday appliances. Pay the visit fee only if you skip the repair.',
    inclusions: ['Doorstep diagnosis', '30-day repair warranty', 'Genuine spare parts'],
    groups: {
      'Washing machine': [
        ['Washing machine check-up', 249, 0, 45],
        ['Washing machine deep clean (top load)', 699, 799, 60],
      ],
      Refrigerator: [['Refrigerator check-up', 299, 0, 45]],
      'Water purifier': [['RO purifier service + filter check', 449, 549, 45, { isPopular: true }]],
      Microwave: [['Microwave repair check-up', 249, 0, 45]],
      Geyser: [['Geyser check-up', 249, 0, 45, { status: 'hidden' }]],
    },
  },
  {
    name: 'Electrician',
    slug: 'electrician',
    icon: 'zap',
    tagline: 'Safe wiring, fixed fast',
    description: 'Licensed electricians for fittings, repairs and full-home inspections.',
    inclusions: ['Licensed electricians', 'Insulated tools & testers', '30-day work warranty'],
    groups: {
      'Switch & socket': [
        ['Switch / socket replacement', 99, 0, 20],
        ['Switchboard installation', 249, 0, 40],
      ],
      Fan: [
        ['Ceiling fan installation', 199, 249, 40, { isPopular: true }],
        ['Fan regulator replacement', 99, 0, 20],
      ],
      Lights: [
        ['Decorative light installation', 299, 0, 45],
        ['Tubelight / batten fitting', 129, 0, 20],
      ],
      Wiring: [
        ['Inverter installation', 499, 599, 60],
        ['Full home electrical inspection', 349, 0, 60],
      ],
    },
  },
  {
    name: 'Plumbing',
    slug: 'plumbing',
    icon: 'droplets',
    tagline: 'Leaks, taps and blocks, sorted',
    description: 'Experienced plumbers for quick fixes and new installations.',
    inclusions: ['Leak test after every job', '30-day work warranty', 'Cleanup after the job'],
    groups: {
      Taps: [
        ['Tap repair / replacement', 129, 0, 30, { isPopular: true }],
        ['Shower head installation', 199, 0, 30],
      ],
      Blockage: [['Drain & sink blockage removal', 299, 349, 45]],
      Toilet: [
        ['Flush tank repair', 249, 0, 45],
        ['Western toilet installation', 1299, 1499, 120],
      ],
      'Water tank': [['Water tank cleaning (up to 1000 L)', 549, 649, 75]],
    },
  },
  {
    name: 'Carpentry',
    slug: 'carpentry',
    icon: 'hammer',
    tagline: 'From loose hinges to new wardrobes',
    description: 'Skilled carpenters with their own power tools, for repairs, assembly and mounting.',
    inclusions: ['Power tools included', 'Dust sheet & cleanup', '30-day work warranty'],
    groups: {
      Doors: [
        ['Door lock installation', 249, 0, 40],
        ['Door hinge repair', 149, 0, 30],
      ],
      Furniture: [
        ['Furniture assembly (per item)', 349, 399, 60, { isPopular: true }],
        ['Bed repair', 399, 0, 60],
      ],
      Mounting: [
        ['Curtain rod installation', 199, 0, 30],
        ['TV wall mounting', 449, 499, 45],
      ],
    },
  },
  {
    name: 'Painting & Waterproofing',
    slug: 'painting',
    icon: 'paint-roller',
    tagline: 'Fresh walls, without the dust',
    description: 'Mechanised, dust-free painting with furniture covering and a supervisor on every job.',
    inclusions: ['Furniture & floor masking', 'Premium emulsion paints', 'Site supervisor'],
    groups: {
      Painting: [
        ['Accent wall painting', 1499, 1799, 240],
        ['1 BHK interior repaint', 9999, 12999, 480, { isPopular: true }],
      ],
      Waterproofing: [['Bathroom waterproofing', 3499, 3999, 300, { cities: ['chennai', 'bengaluru'] }]],
      'Wood polish': [['Door wood polish (per door)', 999, 0, 120]],
    },
  },
  {
    name: 'Pest Control',
    slug: 'pest-control',
    icon: 'bug',
    tagline: 'Odourless, child-safe treatment',
    description: 'Government-approved chemicals, applied by certified technicians, with free follow-ups.',
    inclusions: ['Government-approved chemicals', 'Odourless gel treatment', 'Free follow-up visit'],
    groups: {
      Treatments: [
        ['Cockroach control (1 BHK)', 899, 1099, 60, { isPopular: true }],
        ['Termite treatment (1 BHK)', 3499, 3999, 180],
        ['Bed bug treatment (1 BHK)', 1499, 1799, 90],
        ['Mosquito control', 799, 0, 45],
      ],
    },
  },
];

export function flattenServices(category: SeedCategory): SeedService[] {
  const out: SeedService[] = [];
  for (const [group, list] of Object.entries(category.groups)) {
    for (const [name, price, mrp, minutes, extra] of list) {
      out.push({
        name,
        group,
        price,
        mrp,
        durationMinutes: minutes,
        shortDescription: `${group} by trained ${category.name.toLowerCase()} professionals.`,
        inclusions: category.inclusions,
        exclusions: ['Spare parts or materials beyond the listed service'],
        isPopular: false,
        status: 'active',
        unavailableReason: '',
        cities: [],
        ...extra,
      });
    }
  }
  return out;
}

export const FIRST_NAMES = [
  'Arun', 'Karthik', 'Divya', 'Meena', 'Suresh', 'Lakshmi', 'Vignesh', 'Anitha', 'Rahul', 'Priya',
  'Senthil', 'Kavya', 'Manoj', 'Deepa', 'Ravi', 'Nandhini', 'Ajay', 'Revathi', 'Gokul', 'Sneha',
];
export const LAST_NAMES = ['Kumar', 'Raj', 'Subramani', 'Reddy', 'Nair', 'Iyer', 'Shetty', 'Rao', 'Murugan', 'Pillai'];

export const COUPONS = [
  { code: 'WELCOME100', description: 'Flat ₹100 off your first booking above ₹499', type: 'flat' as const, value: 100, minOrder: 499, perCustomerLimit: 1 },
  { code: 'GENIE20', description: '20% off up to ₹300 on orders above ₹999', type: 'percent' as const, value: 20, maxDiscount: 300, minOrder: 999, perCustomerLimit: 3 },
  { code: 'COOL200', description: 'Flat ₹200 off AC jobs above ₹1,499', type: 'flat' as const, value: 200, minOrder: 1499, perCustomerLimit: 2 },
];

/** Home page banners (solid colours; built-in illustrations until the team uploads photos). */
export const BANNERS = [
  {
    eyebrow: 'Bathroom deep clean',
    title: 'Shine, shine',
    subtitle: 'Tiles, taps and glass, scrubbed back to new.',
    art: 'bathroom' as const,
    background: '#D7F0EA',
    textTone: 'dark' as const,
    action: 'service' as const,
    target: 'bathroom-deep-cleaning',
  },
  {
    eyebrow: 'Use code WELCOME100',
    title: 'Flat ₹100 off',
    subtitle: 'On your first booking above ₹499',
    art: 'gift' as const,
    background: '#5B3FD9',
    textTone: 'light' as const,
    action: 'coupon' as const,
    target: 'WELCOME100',
  },
  {
    eyebrow: 'Summer-ready',
    title: 'AC service, cool in an hour',
    subtitle: 'Foam-jet clean, gas check and a cooling test.',
    art: 'ac' as const,
    background: '#CDE8FF',
    textTone: 'dark' as const,
    action: 'service' as const,
    target: 'foam-jet-ac-service-split',
  },
  {
    eyebrow: 'Use code GENIE20',
    title: '20% off, up to ₹300',
    subtitle: 'On bookings above ₹999',
    art: 'gift' as const,
    background: '#FFD43B',
    textTone: 'dark' as const,
    action: 'coupon' as const,
    target: 'GENIE20',
  },
];
