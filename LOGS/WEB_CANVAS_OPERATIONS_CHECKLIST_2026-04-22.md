# Web Canvas 운영 체크리스트 (1페이지)

## 빠른 시작
- 진입 파일: `TASKS/PROJECTS/web_canvas/app/index.html`
- 첫 확인: `Ctrl+F5` 강력 새로고침
- 작업 전: `Export`로 JSON 스냅샷 저장

## 기본 동작 확인
- 더블클릭: 노드 생성
- 클릭: 단일 선택
- `Ctrl/Cmd+클릭`: 다중 선택
- 드래그: 노드 이동
- `Delete`: 단일 삭제
- `Shift+Delete`: 다중 삭제

## 저장/복구
- `Export`: 현재 상태 JSON 저장
- `Import`: JSON 복원
- `Reset Saved`: localStorage 초기화 + 시작 상태 재생성
- 명령 대체: `초기화` / `reset` / `clear saved`

## 장애 대응 순서
1. `Ctrl+F5` 후 재현 확인
2. `Reset Saved` 실행 후 재확인
3. 최신 `Export` JSON `Import`
4. 계속 재현 시 Command 로그 확인

## 로그 확인 포인트
- `debug: del_req(...)`
  - `selected=[...]`
  - `dupNodeIds=...`
- `debug: del_target(nodes=[...], group=...)`

## 대표 증상별 기준
- 하나 삭제 시 여러 노드 삭제:
  - `del_target(nodes=[...])`가 다중이면 선택 상태/ID 충돌 가능성
- `konva.min.js ... setAttrs`:
  - 드래그-렌더 타이밍 충돌 가능성
  - 새로고침 후 재현 여부부터 재확인

## 운영 원칙
- 다중 삭제는 의도된 상황에서만 사용 (`Shift+Delete`, `삭제 전체`)
- 중요한 변경 전/후로 `Export` 유지
- 이슈 공유 시: “직전 행동 3단계 + debug 로그 2줄” 포함

