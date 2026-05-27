# Daily Worklog Bot

KST 기준 평일(월~금) 08:00에 대상 작업일의 Discord 채널 메시지를 모아 업무 일지를 생성합니다.

스케줄 정책:

- 월요일(KST) 08:00 실행 → 직전 금요일(KST 00:00~24:00) 메시지를 수집
- 화~금요일(KST) 08:00 실행 → 전날(KST 00:00~24:00) 메시지를 수집
- 토/일요일(KST)에는 자동 실행되지 않음. `workflow_dispatch`로 수동 실행 시에는 "주말에는 보고를 생성하지 않습니다" 로그를 남기고 종료 코드 0으로 정상 종료
- GitHub Actions cron(UTC): `0 23 * * 0-4` (KST 월~금 08:00에 해당)

생성 내용 (6개 섹션, Notion 페이지와 Discord 메시지 모두 같은 순서):

1. 한 일 (`done`)
2. 트러블슈팅 (`troubleshooting`)
3. 배운점 (`lessons`)
4. 개선할점 (`improvements`)
5. 메모/기타 (`notes`)
6. 내일 할 일 (`tomorrow`)

각 섹션은 Gemini 응답을 기반으로 1~6개 항목으로 채워지며, 응답이 누락되거나 비어 있으면 한국어 플레이스홀더 1줄로 보충됩니다 (예: "기록된 한 일이 없습니다.").

기타 출력:

- 날짜와 제목
- Discord 웹훅 전송 (마크다운 텍스트)
- Notion 데이터베이스에 하루 업무 일지 페이지 추가 (heading_2 6개 + 각 섹션 bulleted_list_item)


필수 값:

- `DISCORD_BOT_TOKEN`: 채널 메시지를 읽을 Discord 봇 토큰
- `DISCORD_CHANNEL_IDS`: 수집할 채널 ID 목록
- `DISCORD_WEBHOOK_URL`: 일지를 보낼 Discord 웹훅 URL
- `NOTION_TOKEN`: Notion integration secret
- `NOTION_DATABASE_ID`: Notion 데이터베이스 ID
- `GEMINI_API_KEY`: Gemini API key

선택 값:

- `GEMINI_MODEL`: 기본값 `gemini-2.5-flash` (콤마로 여러 모델 지정 가능: `gemini-2.0-flash,gemini-2.5-flash`)
- `DAILY_REPORT_TIME`: 기본값 `08:00`
- `TIMEZONE`: 기본값 `Asia/Seoul`
- `DRY_RUN=true`: Discord/Notion 전송 없이 콘솔 출력만 확인합니다.

## Discord 설정

봇이 채널 메시지를 읽으려면 Discord Developer Portal에서 봇을 만들고 서버에 초대해야 합니다.
수집 대상 채널에는 최소 `View Channel`, `Read Message History` 권한이 필요합니다.
메시지 본문까지 요약하려면 봇의 `MESSAGE CONTENT INTENT`도 활성화해야 합니다.

웹훅은 전송 전용이므로, 채널 메시지 조회에는 반드시 봇 토큰이 필요합니다.

## Notion 설정

Notion integration을 만든 뒤, 대상 데이터베이스에 integration을 초대하세요.
데이터베이스에는 title 속성이 반드시 있어야 합니다. date 속성이 있으면 자동으로 날짜를 채웁니다.

## 로컬 실행

한 번만 실행:

```bash
npm run run-once
```

상시 실행:

```bash
npm start
```

PowerShell에서 `npm.ps1` 실행 정책 오류가 나면 아래처럼 실행하세요.

```powershell
npm.cmd run run-once
npm.cmd start
```

## GitHub Actions 등록

이 저장소에는 `.github/workflows/daily-worklog.yml`이 포함되어 있습니다.



등록 후 `Actions > Daily Worklog > Run workflow`로 수동 테스트할 수 있습니다.

## 트러블슈팅

`Unknown Channel (code 10003)`:

- `DISCORD_CHANNEL_IDS`가 숫자 ID인지 확인하세요. (예: `123...` / 또는 `<#123...>`도 가능하지만 숫자만 추출되는지 확인)
- 봇이 해당 서버에 초대되어 있는지 확인하세요.
- 봇에 `View Channel`, `Read Message History` 권한이 있는지 확인하세요.

## Weekly Troubleshooting Database

기존 업무일지(Notion DB)를 읽어서, 특정 Notion 페이지 아래에 트러블슈팅용 새 데이터베이스(없으면 생성)를 만들고, 트러블슈팅 bullet 항목별로 페이지를 추가합니다.

- 실행 스크립트: `node src/troubleshooting.js`
- GitHub Actions: `.github/workflows/weekly-troubleshooting.yml` (매주 월요일 09:00 KST)

필수 환경변수:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID` (업무일지 DB)
- `NOTION_TROUBLESHOOT_PARENT_PAGE_ID` (트러블슈팅 DB를 만들/둘 상위 Notion 페이지 ID/링크. 실수로 DB 링크를 넣으면 해당 DB에 컨테이너 페이지를 만든 뒤 그 아래에 생성)

선택 환경변수:

- `NOTION_TROUBLESHOOT_DATABASE_NAME` (기본값: `Troubleshooting`)
- `NOTION_TROUBLESHOOT_CONTAINER_PAGE_TITLE` (기본값: `Troubleshooting`)
- `TROUBLESHOOT_LOOKBACK_DAYS` (기본값: `7`)
- `DRY_RUN=true` (생성 대신 콘솔 출력)
