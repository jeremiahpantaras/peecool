// Single source of truth for the proposal. The PDF (HTML), DOCX and Markdown renderers all read from here.
// Feature wording was checked against the pickle-scoring codebase (docs/planning, apps/*, packages/shared).

export const meta = {
  docTitle: 'Pickleball Court Management and Scoring System',
  kicker: 'Business proposal',
  preparedBy: 'Elpisoft',
  client: '[CLIENT / BUSINESS NAME]',
  date: '[PROPOSAL DATE]',
  reference: '[PROPOSAL REFERENCE NO.]',
  validity: '[VALIDITY PERIOD]',
  footer: 'Elpisoft · Pickleball Court Management and Scoring System · Proposal',
  tagline: 'Software built on hope.',
  contact: {
    web: 'www.elpisoft.com',
    email: 'elpisoftph@gmail.com',
    phone: '(+63) 908 560 8811',
    phoneNote: 'Call, WhatsApp, Viber or Telegram',
    address: 'Bacolod City, Negros Island, Philippines 6100',
  },
  signatory: { name: 'Jeremiah Pantaras', title: 'Founder and CEO' },
};

export const executive = {
  title: 'Executive summary',
  intro: [
    'Elpisoft is a custom software studio based in Bacolod City, Philippines. We design and build dependable web, mobile and business systems that help teams move forward with confidence.',
    'This proposal presents the Pickleball Court Management and Scoring System: a complete facility management and scoring solution that runs on your own premises, on your own network.',
  ],
  need: {
    title: 'The business need',
    text: 'A busy pickleball facility has many courts, many matches and a front desk that needs to know what is happening on every court. Paper score sheets, whiteboards and separate apps make it hard to see which courts are free, keep accurate results, and understand how the facility is being used.',
  },
  solution: {
    title: 'The proposed solution',
    text: 'One Windows 11 computer at the front desk becomes the Master System: the control centre for courts, matches, players, schedules and reports. Each court gets its own scoring screen on a tablet or smartphone. Scores travel instantly to the Master System over the facility’s own Wi-Fi, so the system keeps working even when the internet is down.',
  },
  valueTitle: 'What the facility gains',
  value: [
    ['Centralised facility management', 'Courts, matches, players, schedules and reports in one place.'],
    ['Independent court scoring', 'Every court scores its own match on its own device.'],
    ['Real-time score monitoring', 'Live scores from every court on the Master System.'],
    ['Faster match administration', 'Start a match in a few taps; results are saved automatically.'],
    ['Accurate match records', 'Every game, score and duration is stored for later reference.'],
    ['Offline operation', 'Runs on the local network. No internet needed for daily operation.'],
    ['Expandable court setup', 'Start with the courts you have and add more, up to 24.'],
    ['Professional reporting', 'Daily, weekly and monthly reports, ready to export.'],
  ],
  note: 'All three packages include the complete current system. Packages differ only in customization, equipment, revisions, maintenance and support, and website services.',
};

export const overview = {
  title: 'Project overview',
  description: [
    'The Pickleball Court Management and Scoring System is a locally deployed system that simplifies court operations, match scoring, player management, match monitoring and facility reporting.',
    'The Master System is the central control centre for the whole facility. Each court operates independently while staying in constant contact with the Master System through the facility’s local network. The system supports up to 24 courts, and the administrator decides how many are in use.',
    'The system is designed for local operation. It does not need an active internet connection for its core scoring and management functions.',
  ],
  objectivesTitle: 'System objectives',
  objectives: [
    'Give the front desk a live view of every court, match and score.',
    'Let each court score its own matches quickly and accurately.',
    'Keep a complete, reliable record of matches, players and results.',
    'Help the owner understand court usage through clear reports.',
    'Keep the facility running without depending on an internet connection.',
  ],
  components: [
    { letter: 'A', name: 'Master System', text: 'The central management application on a designated Windows 11 computer. It hosts the system and its database, and it is where the Admin and Staff manage courts, matches, players, the booking schedule and reports.' },
    { letter: 'B', name: 'Court Scoring System', text: 'An independent scoring screen for each court, opened in the browser of a tablet, smartphone or other compatible device assigned to that court. It sends every point to the Master System in real time.' },
  ],
};

export const masterFeatures = {
  title: 'System features: Master System',
  lead: 'The Master System is the central application installed on the designated Windows 11 computer.',
  groups: [
    { n: '01', title: 'Administrator dashboard', items: [
      'Live overview of every court and its status: available or in use.',
      'Total registered courts and available courts.',
      'Active matches and matches completed today.',
      'Daily match statistics.',
      'Court devices currently online.',
      'Today’s bookings and the next reservation.',
      'Recent activity feed across the facility.',
      'Court utilization and facility performance in the Analytics view.',
    ] },
    { n: '02', title: 'Court management', items: [
      'Register and configure courts.',
      'Set the number of courts in use, up to 24, and change it at any time.',
      'Activate and deactivate courts.',
      'Monitor each court’s status and its active match.',
      'Watch live scores from every court.',
      'Assign a scoring device to each court, see which devices are online, and sign a device out remotely.',
    ] },
    { n: '03', title: 'User and access management', roles: [
      { name: 'Admin (Owner)', items: [
        'Full system access.',
        'Court setup and management.',
        'Staff account management (unlimited Staff accounts).',
        'Match, player and booking schedule management.',
        'Dashboard, analytics and report exports.',
        'System settings.',
        'Database backup and restore.',
        'Correction of finished match results.',
      ] },
      { name: 'Staff', items: [
        'Authorized operational access.',
        'Match creation and management.',
        'Player name assignment.',
        'Court scoring.',
        'Score adjustment and undo during a match.',
        'Match history, reports and schedule viewing.',
        'Court status monitoring.',
      ] },
    ], note: 'Players do not need accounts. A court device is assigned to its court when a staff member signs in on the device and chooses “Use this device for Court N”.' },
    { n: '04', title: 'Match management', items: [
      'Create and start matches on any available court.',
      'Choose Singles or Doubles.',
      'Set scoring rules: points to win, win by 2, and best of 1, 3 or 5 games.',
      'Assign players or use default labels.',
      'Monitor match progress live.',
      'Pause and resume matches.',
      'Complete matches, or end them early with a deliberate confirmation.',
      'Keep every match in the history records.',
    ] },
    { n: '05', title: 'Player management', items: [
      'Player names are optional.',
      'Default labels (for example, “Player 1”) are used when no name is entered.',
      'Select existing players from the player directory.',
      'Type temporary names for walk-in players.',
      'Typed names are not added to the player directory automatically; the Admin decides who is added.',
      'Player names are preserved in historical match records.',
    ] },
    { n: '06', title: 'Booking schedule', items: [
      'Internal court reservation schedule managed by the Admin.',
      'Day, week and agenda views.',
      'Prevents double-booking of the same court and time.',
      'Court cards show when a court is reserved now or next.',
      'Warns staff before a match starts on a reserved court.',
      'Staff can view the schedule; it can be printed or exported.',
    ], note: 'The booking schedule is for facility staff. It does not include online booking, customer accounts or payments.' },
    { n: '07', title: 'Reports and analytics', items: [
      'Match history with game-by-game scores and results.',
      'Daily, weekly and monthly reporting for any date range.',
      'Court utilization and peak hours.',
      'Match durations.',
      'Player participation statistics.',
      'Booking utilization.',
      'Export to CSV files that open in Excel (Admin), and print or save reports as PDF from the browser.',
    ] },
  ],
  backup: {
    title: 'Data protection',
    items: [
      'Automatic daily backup of the database on the Master PC.',
      'Optional copy of backups to a USB drive or network folder.',
      'Admin can restore the system from a backup file.',
    ],
  },
};

export const courtFeatures = {
  title: 'System features: Court Scoring System',
  lead: 'Each registered court has its own scoring screen, opened in the browser of a compatible tablet, smartphone or other browser-enabled device.',
  groups: [
    { n: '01', title: 'Match configuration', items: [
      'Singles (1 vs. 1) or Doubles (2 vs. 2).',
      'Assign players, or leave names empty.',
      'Default player labels when no names are entered.',
      'Scoring rules set per match: points to win, win by 2, number of games, and side-out or rally scoring.',
    ] },
    { n: '02', title: 'Scoring', items: [
      'Real-time score updates.',
      'Separate Team A and Team B scoring.',
      'Default game target of 11 points.',
      'Win-by-2 requirement.',
      'Matches of 1, 3 or 5 games.',
      'Result recorded for every game.',
      'Automatic detection of game and match completion.',
      'Undo the last scoring action and adjust the score during play.',
    ] },
    { n: '03', title: 'Match timer', items: [
      'An independent timer for every court’s match.',
      'Match start and end times recorded.',
      'Elapsed match duration, excluding pauses.',
      'Pause and resume.',
      'Duration saved automatically with the match.',
    ] },
    { n: '04', title: 'Match controls', items: [
      'Start, pause and resume the match.',
      'Adjust scores.',
      'Proceed to the next game.',
      'Complete the match.',
      'End a match early with a deliberate press-and-hold action.',
      'Confirmation before a match is ended.',
    ] },
    { n: '05', title: 'Real-time court synchronization', items: [
      'Live connection to the Master System.',
      'Each court keeps its own independent match.',
      'Live score monitoring from the front desk.',
      'Automatic reconnection after a brief network interruption.',
      'Match restored after a browser refresh.',
      'Every point saved to the central database on the Master PC.',
    ] },
    { n: '06', title: 'Touch-friendly interface', items: [
      'Large score display and large buttons.',
      'Clear team identification.',
      'Visible match timer.',
      'Clear game progression.',
      'Layouts that fit tablets and smartphones.',
      'Simple, easy-to-understand scoring controls.',
    ] },
  ],
};

export const offline = {
  title: 'Offline operation and system architecture',
  lead: 'The system does not need the internet for normal facility operations.',
  plain: 'The system keeps working even when the facility has no internet connection. The Master Computer and the court devices talk to each other directly through the facility’s own local network, the same way devices in an office can share a printer without going online.',
  steps: [
    'The Master System is installed on a Windows 11 computer at the facility.',
    'This Master PC runs the system and keeps the database on its own storage.',
    'The Master PC connects to the facility’s network router with an Ethernet cable.',
    'Court devices connect to the facility’s staff-only Wi-Fi network.',
    'Each court device opens its own scoring screen in a web browser.',
    'Scores and match information reach the Master System in real time.',
  ],
  compare: [
    { name: 'Internet', text: 'The connection from your facility to the outside world, provided by an internet service provider. Not needed for daily scoring and management.' },
    { name: 'Local network', text: 'The private network inside your facility, made of your router and Wi-Fi access points. The system needs this to connect court devices to the Master PC.' },
  ],
  needs: 'The facility still needs a working router and Wi-Fi access points so the court devices can reach the Master PC. If the Master PC is switched off, or a court device loses the Wi-Fi, scoring on that court pauses until the connection returns. Nothing already saved is lost.',
  tech: [
    ['Operating system', 'Windows 11'],
    ['Database', 'SQLite, stored locally on the Master PC'],
    ['Master PC network', 'Wired Ethernet connection'],
    ['Court connectivity', 'Dedicated staff-only Wi-Fi'],
    ['Master PC address', 'Fixed local IP address'],
    ['Power protection', 'UPS recommended'],
    ['Internet', 'Not required for core system operation'],
  ],
};

const SYSTEM_INCLUSIONS = [
  'Complete Pickleball Court Management and Scoring System',
  'Full access to all current system features',
  'Master System',
  'Court Scoring System',
  'Multi-court management (up to 24 courts)',
  'Singles and Doubles support',
  'Match and game scoring',
  'Match timer',
  'Player management',
  'Booking schedule',
  'Match history',
  'Dashboard and analytics',
  'Offline local network operation',
  'Database installation and configuration',
  'Initial system setup',
  'Basic deployment assistance',
];

export const packages = [
  {
    id: 'A', tier: 'Package A', name: 'Standard System', price: 'PHP 10,000 – PHP 15,000', priceShort: '10,000 – 15,000',
    description: 'A complete Pickleball Court Management and Scoring System with all currently available core features, for facilities that already have their own computer and compatible court devices.',
    card: {
      inclusions: ['Complete system with every current feature', 'Master System and Court Scoring System', 'Database installation and initial setup', 'Basic deployment assistance'],
      customization: 'Standard Elpisoft system design',
      equipment: 'None included. Client provides the Master PC and court devices.',
      revisions: 'Up to 5 revisions within 3 months',
      support: 'Not included after delivery and initial handover',
      benefits: 'Same complete feature set as every package, at the lowest entry price',
    },
    detail: {
      inclusionsTitle: 'Complete inclusions',
      inclusions: SYSTEM_INCLUSIONS,
      blocks: [
        { title: 'Customization', items: ['Standard Elpisoft system design.', 'No custom branding or logo integration.', 'No custom color palette.', 'No personalized interface redesign.'] },
        { title: 'Hardware', items: ['No physical computer or tablet included.', 'The client provides the Master PC and court devices.'] },
        { title: 'Revision policy', items: ['Up to 5 revisions.', 'Revision period: 3 months.'] },
        { title: 'Maintenance and support', items: ['No maintenance package included.', 'No ongoing technical support after delivery and initial handover.'] },
      ],
      callout: { title: 'Deployment assistance is not maintenance', text: 'Package A includes help to install, configure and hand over the system. Ongoing maintenance and technical support after handover are not included, and can be arranged separately.' },
    },
  },
  {
    id: 'B', tier: 'Package B', name: 'Customized System', price: 'PHP 20,000 – PHP 30,000', priceShort: '20,000 – 30,000',
    description: 'The complete system with personalized branding, an included Master PC, and an extended period of technical support.',
    card: {
      inclusions: ['Everything in Package A', 'Full design customization with your brand', 'One Master PC, configured and set up', '6 months of maintenance and support'],
      customization: 'Custom logo, brand colors and personalized interface',
      equipment: 'One computer for the Master System',
      revisions: 'Up to 10 revisions within 6 months',
      support: '6 months of maintenance and technical support',
      benefits: 'A system that looks like your facility, on a ready-to-use Master PC',
    },
    detail: {
      inclusionsTitle: 'Everything in Package A, plus',
      inclusions: [],
      blocks: [
        { title: 'Full design customization', items: ['Custom logo integration.', 'Custom brand colors and color palette.', 'Personalized system appearance.', 'Customized Master Dashboard.', 'Customized Court Scoring screen.', 'Consistent branding across the whole application.'] },
        { title: 'Included Master PC', items: ['One computer device for the Master System.', 'Computer configuration and initial setup.', 'The specific device configuration will be confirmed in the final quotation.', 'Court tablets and smartphones are not included.'] },
        { title: 'Revision policy', items: ['Up to 10 revisions.', 'Revision period: 6 months.'] },
        { title: 'Maintenance and support', items: ['6 months of maintenance and technical support.', 'System-related technical assistance.', 'Troubleshooting.', 'Eligible bug fixes, according to the agreed service terms.'] },
      ],
      callout: null,
    },
  },
  {
    id: 'C', tier: 'Package C', name: 'Complete Business Solution', price: 'PHP 50,000 – PHP 60,000', priceShort: '50,000 – 60,000',
    description: 'The complete branded system and Master PC, combined with extended technical support and a business website that strengthens the facility’s online presence.',
    card: {
      inclusions: ['Everything in Package A and Package B', 'Business funnel website', 'Domain registration and website hosting', '8 months of maintenance and support'],
      customization: 'Custom logo, brand colors and personalized interface',
      equipment: 'One computer for the Master System',
      revisions: 'Up to 10 revisions within 6 months',
      support: '8 months of maintenance and technical support',
      benefits: 'A branded facility system plus a website that helps customers find and contact you',
    },
    detail: {
      inclusionsTitle: 'Everything in Package A and Package B, plus',
      inclusions: [],
      blocks: [
        { title: 'Extended maintenance and support', items: ['8 months of maintenance and technical support.', 'This replaces the 6-month support period of Package B, for a total of 8 months.'] },
        { title: 'Business funnel website', items: ['Custom business landing page.', 'Facility introduction.', 'Services and offerings.', 'Pickleball court information.', 'Contact information.', 'Inquiry or contact call-to-action.', 'Mobile-responsive design.'] },
        { title: 'Domain and hosting', items: ['Domain registration and custom domain integration.', 'Website hosting.', 'Initial deployment and configuration.', 'Subject to domain availability and the agreed registration and hosting term.'] },
      ],
      callout: { title: 'What the website does', text: 'The website helps prospective customers discover the facility, understand its offerings and contact the business. Online court booking, payment processing and customer accounts are not included unless separately approved.' },
    },
  },
];

export const comparison = {
  title: 'Package comparison',
  lead: 'Every package includes the complete current system. Package C inherits all of Package B’s system and hardware inclusions, extends maintenance to 8 months, and adds website services.',
  rows: [
    ['Complete system features', 'Included', 'Included', 'Included'],
    ['Master System', 'Included', 'Included', 'Included'],
    ['Court Scoring System', 'Included', 'Included', 'Included'],
    ['All current core features', 'Included', 'Included', 'Included'],
    ['Custom logo and branding', 'Not included', 'Included', 'Included'],
    ['Custom color palette', 'Not included', 'Included', 'Included'],
    ['Master PC device', 'Not included', 'Included', 'Included'],
    ['Revisions', '5', '10', '10'],
    ['Revision period', '3 months', '6 months', '6 months'],
    ['Maintenance and support', 'Not included', '6 months', '8 months'],
    ['Business funnel website', 'Not included', 'Not included', 'Included'],
    ['Custom domain', 'Not included', 'Not included', 'Included'],
    ['Website hosting', 'Not included', 'Not included', 'Included'],
  ],
};

export const hardware = {
  title: 'Hardware and network requirements',
  lead: 'The equipment below is needed to run the system at the facility. The table at the end shows what each package includes.',
  groups: [
    { title: 'Master PC', items: [
      'Windows 11 computer (64-bit).',
      'Recommended minimum: 4-core processor, 8 GB memory, SSD storage with at least 10 GB free.',
      'Wired Ethernet connection recommended.',
      'UPS protection recommended.',
      'Local storage for the system database.',
    ] },
    { title: 'Network', items: [
      'Local network router.',
      'Wi-Fi access points with enough coverage for every court. As a guide, about one access point for every 4 to 6 courts; a site check is recommended.',
      'A staff-only Wi-Fi network, separate from any guest Wi-Fi.',
      'A fixed local IP address for the Master PC.',
      'A UPS that also covers the router and network switch is recommended.',
    ] },
    { title: 'Court devices', items: [
      'Compatible tablets, smartphones or other browser-enabled devices. Tablets are preferred; recent mid-range devices (2019 or newer) are recommended.',
      'Connected to the facility’s staff-only Wi-Fi.',
      'One assigned device per active court, where applicable.',
    ] },
  ],
  matrixTitle: 'Equipment included by package',
  matrix: [
    ['Master PC (one device)', 'Not included', 'Included', 'Included'],
    ['Court tablets or smartphones', 'Not included', 'Not included', 'Not included'],
    ['Router and Wi-Fi access points', 'Not included', 'Not included', 'Not included'],
    ['UPS units', 'Not included', 'Not included', 'Not included'],
  ],
  matrixNote: 'Items marked “Not included” are provided by the client, or can be quoted separately on request. The Master PC configuration for Packages B and C is confirmed in the final quotation.',
};

export const implementation = {
  title: 'Implementation and deployment',
  lead: 'Delivery follows nine clear stages. Target dates are agreed after the requirements are confirmed.',
  steps: [
    ['Proposal approval', 'The client selects a package and signs the acceptance page. The initial payment is arranged according to the payment terms.'],
    ['Requirements confirmation', 'We confirm the number of courts, scoring rules, user accounts, branding materials (Packages B and C) and website content (Package C).'],
    ['System design and planning', 'We prepare the system configuration and, for Packages B and C, the customized design for the client’s review and approval.'],
    ['Application development', 'We prepare the client’s build of the system: configuration, approved customizations and, for Package C, the business website.'],
    ['System testing', 'We test scoring, match flow, synchronization and reports with the client’s settings before installation.'],
    ['Local computer installation', 'We install the Master System and its database on the Master PC, set its fixed local IP address and confirm it starts reliably.'],
    ['Court device configuration', 'We connect each court device to the staff-only Wi-Fi, open its scoring screen and assign it to its court.'],
    ['Initial deployment', 'We run the system live at the facility with real matches and fix any setup issues on site.'],
    ['Client orientation and handover', 'We walk the Admin and Staff through daily use, backups and reports, then formally hand over the system.'],
  ],
  datesNote: 'Project start: [START DATE] · Target installation: [INSTALLATION DATE] · Target handover: [HANDOVER DATE]',
};

export const glossary = {
  title: 'Understanding the system: Definition of terms',
  lead: 'Plain explanations of the technical words used in this proposal.',
  rows: [
    ['Master System', 'The main program on the front-desk computer. It controls the whole facility: courts, matches, players, schedules and reports.'],
    ['Court Scoring System', 'The scoring screen used at each court. It runs on a tablet or phone and sends every point to the Master System.'],
    ['Local Network (LAN)', 'A private connection between the computers, tablets and other devices inside the facility. It lets them communicate without the internet.'],
    ['Wi-Fi / WLAN', 'The wireless part of the local network. Court tablets and phones use it to reach the Master Computer.'],
    ['Offline System', 'A system that keeps working without the internet, because everything it needs is inside the facility.'],
    ['Internet Connection', 'The link from the facility to the outside world, provided by an internet service provider. The scoring system does not need it for daily use.'],
    ['Local Server', 'A computer inside the facility that runs the system for every other device. Here, it is the Master PC.'],
    ['SQLite Database', 'A local digital storage system where match records, scores, player information and system data are saved directly on the Master Computer.'],
    ['Real-Time Synchronization', 'When a score changes on a court device, the Master System receives and displays the updated score almost immediately.'],
    ['Dashboard', 'The main screen that summarizes what is happening right now: courts in use, active matches and today’s numbers.'],
    ['Analytics', 'Charts and figures that show how the facility is used over time, such as busy hours and court usage.'],
    ['Match History', 'A saved list of past matches with players, scores, results and how long each match took.'],
    ['Singles', 'A match with one player on each side (1 vs. 1).'],
    ['Doubles', 'A match with two players on each side (2 vs. 2).'],
    ['Game / Set', 'One round of play that ends when a side reaches the target score. A match can be 1, 3 or 5 games. The system calls these “games”.'],
    ['Win by 2', 'A team must lead by at least two points to win. For example, 11–10 does not end the game, but 12–10 does.'],
    ['Match Timer', 'A clock that records when a match starts and ends and how long it lasted, not counting pauses.'],
    ['Device Pairing', 'Linking a tablet or phone to a specific court. A staff member signs in on the device and chooses “Use this device for Court N”. No codes or extra setup are needed.'],
    ['Administrator', 'The owner’s account, with full control of the system, including settings, staff accounts and backups.'],
    ['Staff Account', 'A login for facility staff to run matches, score courts and view information, without changing system settings.'],
    ['Backup and Restore', 'Saving a safe copy of the system’s data (backup) and bringing it back if something goes wrong (restore).'],
    ['Domain Name', 'The website address customers type in a browser, such as www.yourfacility.com.'],
    ['Website Hosting', 'The online service that stores the website and makes it available on the internet.'],
    ['Responsive Design', 'A design that adjusts automatically to look good on phones, tablets and computers.'],
    ['Customization', 'Changing the system’s look to match your business, such as your logo and brand colors.'],
    ['Maintenance and Support', 'Help after handover: answering questions, troubleshooting problems and fixing eligible bugs during the support period.'],
    ['Revision', 'A requested adjustment to the approved design, existing features or agreed deliverables.'],
    ['Business Funnel Website', 'A website designed to introduce the business, present its services and encourage visitors to contact or inquire about the facility.'],
  ],
};

export const terms = {
  title: 'Terms and conditions',
  lead: 'Proposed commercial terms. Items in brackets are confirmed in the final quotation or agreement.',
  sections: [
    { title: 'Pricing and quotation', items: [
      'Prices are in Philippine Pesos (PHP) and are shown as ranges. The final price is confirmed in a written quotation after the requirements are confirmed.',
      'Taxes: [TAX TREATMENT].',
      'This proposal is valid for [VALIDITY PERIOD] from the proposal date.',
    ] },
    { title: 'Payment terms', items: [
      'Initial down payment: [DOWN PAYMENT AMOUNT OR PERCENTAGE], due upon proposal approval.',
      'Development milestone payments: [MILESTONE PAYMENT SCHEDULE].',
      'Final balance: [FINAL BALANCE AND DUE DATE], due upon [HANDOVER / ACCEPTANCE CONDITION].',
      'Accepted payment methods: [PAYMENT METHODS].',
    ] },
    { title: 'Revisions', items: [
      'A revision is an adjustment to the approved design, existing features or agreed deliverables.',
      'Revision allowance: Package A, up to 5 within 3 months; Packages B and C, up to 10 within 6 months. Periods start on [REVISION PERIOD START].',
      'A revision does not include new major modules, new integrations, entirely new functionality, or changes to previously approved project scope.',
      'Additional work outside these limits may require a separate quotation.',
    ] },
    { title: 'Maintenance and support', items: [
      'Coverage starts on [SUPPORT START DATE, e.g. date of handover].',
      'Duration: Package A, not included; Package B, 6 months; Package C, 8 months.',
      'Covers system-related technical assistance, troubleshooting and eligible bug fixes in the delivered system.',
      'Excludes hardware faults, network or internet provider problems, third-party software, misuse or unauthorized changes, and new features or modules.',
      'Support contact: elpisoftph@gmail.com and (+63) 908 560 8811, during [SUPPORT HOURS], with response times of [RESPONSE TIME].',
    ] },
    { title: 'Hardware (Packages B and C)', items: [
      'One (1) Master PC is included.',
      'Final hardware specifications are confirmed in the final quotation.',
      'Hardware warranty: [WARRANTY TERMS, as provided by the manufacturer or supplier].',
      'Court tablets, smartphones, routers, access points and UPS units are separate unless expressly included.',
    ] },
    { title: 'Domain and hosting (Package C)', items: [
      'Domain registration and website hosting are included for an initial term of [REGISTRATION AND HOSTING TERM].',
      'Renewal after the initial term: [RENEWAL ARRANGEMENT AND FEES].',
      'Domain ownership and account access: [DOMAIN OWNERSHIP AND ACCOUNT ACCESS ARRANGEMENT].',
      'The domain name is subject to availability. Hosting is not provided for life.',
    ] },
    { title: 'Software ownership and licensing', items: [
      'Application ownership: [TO BE AGREED].',
      'Client usage rights: [TO BE AGREED].',
      'Source code delivery: [TO BE AGREED].',
      'Third-party software and licenses: the system uses third-party components under their own licenses, and Windows 11 is licensed separately. [ADDITIONAL TERMS TO BE AGREED].',
      'Intellectual property: [TO BE AGREED].',
    ] },
  ],
};

export const acceptance = {
  title: 'Acceptance and approval',
  lead: 'By signing below, both parties agree to proceed with the selected package under the terms of this proposal and the final quotation.',
  packageLine: 'Selected package:  ☐ Package A — Standard System   ☐ Package B — Customized System   ☐ Package C — Complete Business Solution',
  client: { heading: 'Client', fields: ['Business name: [CLIENT / BUSINESS NAME]', 'Authorized representative:', 'Position:', 'Signature:', 'Date:'] },
  elpisoft: { heading: 'Elpisoft', fields: ['Representative: Jeremiah Pantaras', 'Position: Founder and CEO', 'Signature:', 'Date:'] },
};
