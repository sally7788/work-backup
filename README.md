# Daily Worklog Bot

KST 기준 매일 08:00에 전날 Discord 채널 메시지를 모아 업무 일지를 생성합니다.

생성 내용:

- 날짜
- 제목
- 진행한 내용 간단 요약
- 트러블 슈팅 내용
- Discord 웹훅 전송
- Notion 데이터베이스에 하루 업무 일지 페이지 추가


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
