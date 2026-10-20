// Screen text — English only.
// 2026-10-16: the Korean/Mongolian pair was dropped on the owner's request. One language,
// so the two can no longer disagree with each other. Member-written text (notices, posts,
// events) is machine-translated into English and shown next to the original — lib/translate.js.
// The club rules stay in Korean and Mongolian (that document is written in both);
// the rules screen has its own language picker.
export const DICT = {
  en: {
    memberOnly: 'Members only',
    phone: 'Phone number', pin: 'PIN (4 digits)', login: 'Log in', logout: 'Log out',
    loginFail: 'Phone number or PIN is wrong', loginLocked: 'Too many tries — wait {s} seconds',
    loginDormant: 'This membership has ended. Please contact an officer.',
    loggingIn: 'Checking…',

    tabHome: 'Home', tabSchedule: 'Schedule', tabDues: 'Dues', tabNotices: 'Notices', tabMembers: 'Members',
    tabBoard: 'Board',

    changePin: 'Change PIN', settings: 'Settings', cancel: 'Cancel', save: 'Save',
    add: 'Add', edit: 'Edit', del: 'Delete', close: 'Close', confirmDelete: 'Delete this?',
    saved: 'Saved', deleted: 'Deleted', failed: 'Something went wrong', required: 'Required',
    admin: 'Officer', member: 'Member', adminOnly: 'Officers only',

    upcoming: 'Coming up', noUpcoming: 'Nothing coming up',
    pinnedNotice: 'Pinned notice', myDues: 'My dues', quickUnpaid: 'Unpaid this month',
    greetMorning: 'Hello', today: 'Today',

    schedule: 'Schedule', newEvent: 'New event', editEvent: 'Edit event',
    kindRegular: 'Club Night', kindEvent: 'Event', kindTournament: 'Tournament',
    title: 'Title', kind: 'Type', date: 'Date', startTime: 'Start', endTime: 'End',
    courts: 'Courts', memo: 'Note', upcomingTab: 'Upcoming', pastTab: 'Past',
    courtsN: '{n} courts', noEvents: 'No events', endBeforeStart: 'End time is before the start time',
    yes: 'Going', no: 'Not going', maybe: 'Maybe',
    attendCount: '{n} going', roster: 'Who is coming', noAnswerYet: 'No answers yet', myAnswer: 'My answer',

    dues: 'Dues', monthlyFee: 'Monthly dues', joiningFee: 'Joining fee',
    paid: 'Paid', unpaid: 'Unpaid', paidAt: 'Paid on', method: 'How',
    cash: 'Cash', transfer: 'Bank transfer', qpay: 'QPay',
    duesGrid: 'Member payments', unpaidList: 'Not paid yet', allPaid: 'Everyone has paid 🎉',
    collected: 'Collected', expected: 'Expected', members: 'Members',
    myDuesEmpty: 'No dues records yet', joiningLabel: 'Joining fee',
    inJoiningFee: 'Joining month — included in the joining fee',
    inJoiningFeeHint: 'includes the first month',
    markPaid: 'Mark as paid', markUnpaid: 'Mark as unpaid',

    notices: 'Notices', newNotice: 'New notice', editNotice: 'Edit notice',
    body: 'Message', photo: 'Photo', pinTop: 'Pin to top', pinned: 'Pinned',
    noNotices: 'No notices', photoPick: 'Choose photo', photoRemove: 'Remove photo',
    photoTooBig: 'Photo is too large', readOnly: 'Only officers can post here',

    memberList: 'Member list', newMember: 'Add member', editMember: 'Edit member',
    name: 'Name', level: 'Level', joinedAt: 'Joined', status: 'Status', role: 'Role',
    lvNewbie: 'New', lvBeginner: 'Beginner', lvIntermediate: 'Intermediate', lvAdvanced: 'Advanced',
    coach: 'Coach', filterAll: 'All', filterCoaches: 'Coaches', noCoaches: 'No coaches yet', allLevels: 'All levels', searchName: 'Search by name', noMatch: 'No members match', coachYes: 'Yes — coach', coachNo: 'No', myLevel: 'My level · Coach',
    joinAs: 'Join as', joinAsMember: 'Member', joinAsCoach: 'Coach',
    myLevelHint: 'Pick the level that fits you. Turn on Coach if you give lessons — a 🎾 Coach badge shows in the member list.',
    stActive: 'Active', stDormant: 'Left',
    membersN: '{n} members', activeN: '{n} active', phoneTaken: 'That phone number is already registered',
    badPhone: 'Phone number must be 8 digits', pin4: 'PIN must be 4 digits',
    resetPin: 'Reset PIN', newPin: 'New PIN', firstPin: 'First PIN: {pin}',
    lastAdmin: 'The last officer cannot be changed',
    currentPin: 'Current PIN', pinChanged: 'PIN changed', badCurrentPin: 'Current PIN is wrong',
    clubName: 'Club name', titleRole: 'Position',

    roleOwner: 'Owner',
    adminGive: 'Officer (give rights)',
    ownerOnly: 'Only the club owner can do this',
    cannotDeleteOwner: 'The club owner cannot be deleted',
    ownerNote: 'Giving or taking rights, editing the rules, the org chart, dues amounts and deleting members — owner only.',
    adminNote: 'Officer rights: approve members, post events and notices, mark dues.',

    rulesTitle: 'Club rules',
    rulesVersion: 'version {v}',
    rulesSee: 'Read the rules',
    rulesAgreeCheck: 'I have read and agree to the club rules',
    rulesAgreeBtn: 'I agree',
    rulesAgreed: 'Thank you',
    rulesEdit: 'Edit rules',
    rulesEditHint: 'Saving raises the version number and asks every member to agree again — unless "Small fix" is ticked.',
    rulesMinor: 'Small fix (typo, spacing) — do not ask members to agree again',
    rulesEditOther: 'Edit the {l} version instead',
    rulesSaved: 'Saved (version {v})',
    rulesOnlyKo: 'this language is not ready yet',
    rulesLangKo: '한국어',
    rulesLangMn: 'Монгол',

    orgTitle: 'Officers',
    orgHonorary: 'Honorary',
    orgAssign: '+ assign',
    orgPickMember: 'Pick from members',
    orgNotMember: '— not set —',
    orgNameOnly: 'Not a member? Type a name',
    orgNameOnlyHint: 'e.g. honorary chairman',
    orgHint: 'If you pick a member, the chart follows their name when it changes.',
    role_owner: 'Club Owner · Head Coach',
    role_president: 'Chairman',
    role_vice1: 'Vice Chairman 1',
    role_vice2: 'Vice Chairman 2',
    role_manager1: 'Secretary 1',
    role_manager2: 'Secretary 2',
    role_match: 'Match Director',
    role_event: 'Event Director',
    role_external: 'Partnerships Director',
    role_honorary: 'Honorary Chairman',
    role_advisor1: 'Advisor 1',
    role_advisor2: 'Advisor 2',
    role_advisor3: 'Advisor 3',

    pushTitle: 'Phone notifications',
    pushWhat: 'New notices, new posts and comments, new events and dues reminders come to your phone.',
    pushTurnOn: 'Turn on notifications',
    pushOn: 'Notifications are on',
    pushOff: 'Turn off',
    pushOffDone: 'Turned off',
    pushTest: 'Send a test',
    pushSent: 'Sent',
    pushDenied: 'Please allow notifications in your phone settings',
    pushNo: 'This browser does not support notifications',
    pushNeedHome: 'On iPhone you must add the app to the home screen first',
    pushHowIos: 'Safari → Share button → Add to Home Screen → open it from the icon',
    pushOtherDevice: 'On for {n} other device(s)',
    pushNoDevice: 'No device is turned on',

    seeAll: 'See all',
    installApp: 'Install app',
    installTitle: 'Install the app',
    installDone: 'App installed — open it from your home screen',
    installIos: 'Open this page in Safari → tap the Share button (square with arrow) → Add to Home Screen → Add',
    installAndroid: 'Open this page in Chrome → tap ⋮ (top right) → Install app (or Add to home screen)',
    installAndroidStuck: 'If the menu says "Open app" instead, close Chrome completely, open it again and try once more',
    installSamsung: 'Tap ≡ (bottom right) → Add page to → Home screen',
    installInApp: 'This page is open inside another app (KakaoTalk, Facebook…). Copy the link below and open it in your phone browser first',
    installDesktop: 'Click the install icon at the right end of the address bar, or open the browser menu → Install',
    installLink: 'Link to the app',
    installCopy: 'Copy link',
    installCopied: 'Link copied',
    loading: 'Loading…',

    newPost: 'New post',
    editPost: 'Edit post',
    postWhat: 'What happened?',
    postEmpty: 'Write something or add a photo',
    noPosts: 'No posts yet',
    comments: 'Comments',
    noComments: 'No comments',
    commentWrite: 'Write a comment…',
    send: 'Send',
    chat: 'Chat', chats: 'Chats', clubChat: 'Club chat', clubChatSub: 'Everyone in the club',
    newChat: 'New chat', chatPick: 'Chat with', chatOpen: 'Open chat', chatNoMembers: 'No other members yet',
    chatPlaceholder: 'Message…', chatEmpty: 'No messages yet. Say hi! 👋', chatEarlier: 'Earlier messages',
    chatHint: 'Tap 💬 next to a name in Members, or + New chat, to talk one-on-one.',
    chatGone: 'This chat is no longer available', formerMember: 'Former member', you: 'You', message: 'Message',
    more: 'More',
    edited: 'edited',
    editBodyOnly: 'Only the text is edited (to change photos, delete the post and write it again)',
    photoMax: 'up to 4',
    agoNow: 'just now',
    agoMin: '{n} min ago',
    agoHour: '{n} h ago',
    agoDay: '{n} d ago',
    showOriginal: 'original',

    repeat: 'Repeat (several dates at once)',
    repeatAuto: '🪄 Found {days} in the title',
    repeatFrom: 'From',
    repeatTo: 'To',
    repeatPreview: '{n} events will be created',
    repeatNoDays: 'Pick the days of the week',
    repeatNone: 'No matching dates',
    repeatBadRange: 'Check the date range',
    bulkDone: 'Created {n} events',
    bulkDoneSkip: 'Created {n} ({s} already existed)',
    repeatTooMany: 'More than 120 at once — shorten the range',

    joinRequest: 'Apply for membership',
    joinHint: 'After you apply, an officer approves it and then you can log in. Choose your own PIN.',
    joinName: 'Full name', joinNameEn: 'Name in English', joinPin: 'PIN for logging in (4 digits)',
    joinShirt: 'T-shirt size', joinShirtPick: 'Please choose your T-shirt size',
    joinRecommenders: 'Recommended by', joinRecommendersPh: 'Members who recommended you (up to 4)',
    joinReadToEnd: 'Scroll the rules to the end to agree',
    joinReadDone: 'You have read the rules',
    joinNeedRules: 'Please read the rules to the end and tick "I agree"',
    joinPrivacy: 'I agree to the collection and use of my personal information (name, phone number) for running the club',
    joinNeedPrivacy: 'Please agree to the use of your personal information',
    joinAgreedRules: 'Agreed to the rules', joinAgreedPrivacy: 'Agreed to personal info use',
    joinSend: 'Send application',
    joinDone: 'Application sent. Please wait for an officer to approve it.',
    joinPending: 'Applications',
    joinNone: 'No applications',
    joinApprove: 'Approve',
    joinReject: 'Reject',
    joinApproved: '{name} is now a member',
    joinRejected: 'Rejected',
    alreadyMember: 'That phone number is already registered',
    alreadyRequested: 'You have already applied',
    tooManyRequests: 'Too many applications. Please try again later.',

    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

export const LANG = 'en';

export function t(key, vars) {
  let s = DICT.en[key] ?? key;
  if (Array.isArray(s)) return s;
  if (vars) for (const k in vars) s = String(s).split(`{${k}}`).join(vars[k]);
  return s;
}

// Fills every element marked with data-i18n.
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.documentElement.lang = 'en';
}

export const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');

// '2026-10-18' → 'Oct 18 (Sun)'
export function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dow = t('dow')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${t('months')[m - 1].slice(0, 3)} ${d} (${dow})`;
}
export const fmtMonth = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return `${t('months')[m - 1]} ${y}`;
};

// '2026-10-15 19:40:12' → '3 h ago'.
// The server writes Ulaanbaatar wall-clock time. We read "now" on the same wall clock,
// so subtracting the two is accurate no matter where the phone is set.
const UB_NOW = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const asTs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');

export function timeAgo(stamp) {
  const then = asTs(stamp);
  if (!Number.isFinite(then)) return String(stamp || '');
  const now = asTs(UB_NOW.format(new Date()).replace('T', ' '));
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return t('agoNow');
  if (sec < 3600) return t('agoMin', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('agoHour', { n: Math.floor(sec / 3600) });
  const days = Math.floor(sec / 86400);
  if (days <= 7) return t('agoDay', { n: days });
  return String(stamp).slice(0, 10);
}

export const levelLabel = (lv) => t({ newbie: 'lvNewbie', beginner: 'lvBeginner', intermediate: 'lvIntermediate', advanced: 'lvAdvanced' }[lv] || 'lvBeginner');
export const kindLabel = (k) => t({ regular: 'kindRegular', event: 'kindEvent', tournament: 'kindTournament' }[k] || 'kindEvent');
export const methodLabel = (m) => (m ? t(m) : '');
