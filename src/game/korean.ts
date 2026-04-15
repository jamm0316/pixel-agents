function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function formatIntent(tool: string, summary: string = ''): string {
  const s = (summary ?? '').trim();
  switch (tool) {
    case 'Read':
      return s ? `${truncate(basename(s), 20)}\n읽어봐야겠다` : '파일을 읽어봐야겠다';
    case 'Write':
      return s ? `${truncate(basename(s), 20)}\n새로 작성해야지` : '파일을 작성해야지';
    case 'Edit':
      return s ? `${truncate(basename(s), 20)}\n수정해야겠다` : '파일을 수정해야겠다';
    case 'Bash':
      return s ? `"${truncate(s, 22)}"\n실행해볼까` : '명령을 실행해볼까';
    case 'Grep':
      return s ? `"${truncate(s, 22)}"\n검색해봐야겠다` : '검색해봐야겠다';
    case 'Glob':
      return s ? `"${truncate(s, 22)}"\n파일들 찾아보자` : '파일들을 찾아보자';
    case 'Task': {
      const name = s.split(':')[0] || '서브에이전트';
      return `${truncate(name, 18)}에게\n작업을 맡겨야지`;
    }
    case 'WebFetch':
      return s ? `${truncate(s, 24)}\n확인해봐야겠다` : '웹을 확인해봐야겠다';
    case 'WebSearch':
      return s ? `"${truncate(s, 18)}"\n검색해봐야겠다` : '검색해봐야겠다';
    case 'TodoWrite':
      return '할 일 목록을\n정리해야겠다';
    default:
      return `${tool}\n써봐야겠다`;
  }
}

export function formatHistoryLine(tool: string, summary: string = ''): string {
  const s = (summary ?? '').trim();
  const file = truncate(basename(s), 28);
  switch (tool) {
    case 'Read':
      return file ? `${file} 읽기 진행` : '파일 읽기 진행';
    case 'Write':
      return file ? `${file} 작성 진행` : '파일 작성 진행';
    case 'Edit':
      return file ? `${file} 수정 진행` : '파일 수정 진행';
    case 'Bash':
      return s ? `명령 실행: ${truncate(s, 34)}` : '명령 실행';
    case 'Grep':
      return s ? `"${truncate(s, 28)}" 검색` : '검색 진행';
    case 'Glob':
      return s ? `"${truncate(s, 28)}" 파일 찾기` : '파일 찾기';
    case 'Task':
    case 'Agent': {
      const name = s.split(':')[0] || '서브에이전트';
      return `${truncate(name, 20)} 호출`;
    }
    case 'WebFetch':
      return s ? `${truncate(s, 32)} 가져오기` : '웹 페이지 가져오기';
    case 'WebSearch':
      return s ? `"${truncate(s, 22)}" 웹 검색` : '웹 검색';
    case 'TodoWrite':
      return '할 일 목록 정리';
    default:
      return `${tool} 사용`;
  }
}

export const OFFICE_CHATTER: string[] = [
  '배고프다...',
  '오늘 뭐 먹지',
  '커피 한 잔 땡긴다',
  '벌써 퇴근 시간?',
  '월요일 진짜 힘들어',
  '메일 확인해야지',
  '잠깐 쉬자',
  '주말이 기다려진다',
  '회의 또 있나',
  '어제 야근했는데',
  '오후엔 집중 안 돼',
  '치킨 시킬까',
  '날씨 좋네',
  '월급날 언제지',
  '이번 스프린트 빡세다',
  '점심 메뉴 고민',
  '이메일이 산더미',
  '퇴근하고 싶다',
  '회의실 비었나',
  '아메리카노 한 잔',
  '야근각인가',
  '주말만 기다린다',
  '슬랙 알림 왜이리 많지',
  '커피 떨어졌네',
];

export function randomChatter(): string {
  return OFFICE_CHATTER[Math.floor(Math.random() * OFFICE_CHATTER.length)];
}

const BATHROOM_LINES = [
  '잠깐 화장실 좀',
  '화장실 다녀올게',
  '갔다 올게!',
  '손 씻고 올게',
];

const BATHROOM_DWELL_LINES = [
  '쉬이이~',
  '후우...',
  '시원하다~',
  '으~',
  '하아...',
];

const PINGPONG_INVITES = [
  '탁구 한 판 어때?',
  '탁구장 갈 사람?',
  '야, 탁구 치자!',
  '한 게임 어때?',
];

const PINGPONG_ACCEPTS = [
  '콜!',
  '좋지, 가자!',
  '오케이',
  '좋아 바로 가자',
];

const PINGPONG_RALLY = [
  '나이스 샷!',
  '이얍!',
  '받아랏',
  '빠르네',
];

export function randomBathroomLine(): string {
  return BATHROOM_LINES[Math.floor(Math.random() * BATHROOM_LINES.length)];
}

export function randomBathroomDwellLine(): string {
  return BATHROOM_DWELL_LINES[Math.floor(Math.random() * BATHROOM_DWELL_LINES.length)];
}

export function randomPingPongInvite(): string {
  return PINGPONG_INVITES[Math.floor(Math.random() * PINGPONG_INVITES.length)];
}

export function randomPingPongAccept(): string {
  return PINGPONG_ACCEPTS[Math.floor(Math.random() * PINGPONG_ACCEPTS.length)];
}

export function randomPingPongRally(): string {
  return PINGPONG_RALLY[Math.floor(Math.random() * PINGPONG_RALLY.length)];
}

export function formatHandoff(target: string): string {
  const name = (target || '').trim() || '누군가';
  return `${truncate(name, 18)}야,\n이것좀 해줘!`;
}

export function parseHandoffTarget(summary: string = ''): string {
  const s = (summary ?? '').trim();
  if (!s) return '';
  const colon = s.indexOf(':');
  return colon >= 0 ? s.slice(0, colon).trim() : s;
}

export function formatPermissionQuestion(tool: string, summary: string = ''): string {
  const s = (summary ?? '').trim();
  switch (tool) {
    case 'Write':
      return s ? `${truncate(basename(s), 24)}\n새로 만들까요?` : '파일을 만들까요?';
    case 'Edit':
      return s ? `${truncate(basename(s), 24)}\n수정할까요?` : '파일을 수정할까요?';
    case 'Bash':
      return s ? `"${truncate(s, 26)}"\n실행할까요?` : '명령을 실행할까요?';
    case 'Task': {
      const name = s.split(':')[0] || '서브에이전트';
      return `${truncate(name, 18)}를\n부를까요?`;
    }
    case 'WebFetch':
      return s ? `${truncate(s, 26)}\n가져올까요?` : '웹 요청을 보낼까요?';
    default:
      return `${tool}을\n진행할까요?`;
  }
}
