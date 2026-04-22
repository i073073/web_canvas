# Web Canvas 운영 메모

## 1) 목적
- 브라우저에서 바로 여는 정적 mind map 캔버스.
- 빌드/서버 없이 `app/index.html` 단일 진입.
- 상태 스키마는 고정: `{ nodes: [], edges: [], groups: [] }`

## 2) 실행
- 파일 열기: `TASKS/PROJECTS/web_canvas/app/index.html`
- 권장: 브라우저 캐시 충돌 시 `Ctrl+F5` 강력 새로고침

## 3) 기본 조작
- 더블클릭: 노드 생성
- 클릭: 단일 선택
- `Ctrl/Cmd+클릭`: 다중 선택
- 드래그: 노드 이동
- 우측 핸들 드래그: 노드 연결
- `Delete`: 기본 단일 삭제
- `Shift+Delete`: 다중 삭제(의도된 경우만)
- 명령창:
  - `삭제` / `delete`: 단일 삭제 우선
  - `삭제 전체` / `bulk delete`: 다중 삭제

## 4) 저장/복구
- `Export`: 현재 상태를 JSON 파일로 저장
- `Import`: JSON 복원
- 상단 `Reset Saved`: 브라우저 저장 상태(localStorage) 초기화 후 시작 상태로 재생성
- 명령창 `초기화` / `reset` / `clear saved`: `Reset Saved`와 동일

## 5) 운영 장애 대응 (빠른 순서)
1. `Ctrl+F5` 후 재현 확인
2. `Reset Saved` 실행 후 재확인
3. 재현 시 `Import`로 최신 백업 JSON 불러오기
4. 그래도 재현 시 오른쪽 Command 로그의 `debug: del_req`, `debug: del_target` 라인 확인

## 6) 최근 안정화 반영
- 삭제 시 선택 정규화 강화
- 중복 ID 정규화 로직 추가(로드/임포트 경로)
- 드래그 중 Transformer 충돌 완화:
  - 드래그 중 `transformend` 무시
  - 렌더 시 레이어 파기 전에 Transformer 분리
- 드래그 시작 시 선택 상태를 명시적으로 현재 노드로 고정

## 7) 알려진 증상과 확인 포인트
- 증상: 하나 삭제했는데 여러 노드 동시 삭제
  - 확인: `debug: del_req`의 `selected=[...]`, `dupNodeIds=...`
  - 확인: `debug: del_target(nodes=[...])`가 단일인지 확인
- 증상: `konva.min.js ... setAttrs` 예외
  - 드래그 직후/렌더 타이밍 충돌 가능성
  - 강력 새로고침 후 재현되면 로그와 함께 공유

## 8) 운영 원칙
- 다중 삭제는 항상 명시 동작(`Shift+Delete`, `삭제 전체`)으로만 사용
- 중요한 작업 전 `Export`로 스냅샷 저장
- 장애 재현 리포트는 “직전 행동 3단계 + Command 로그 2줄”로 남김

