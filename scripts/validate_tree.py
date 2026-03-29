#!/usr/bin/env python3
"""의사결정 트리 README.md 검증 스크립트.

검사 항목:
- YAML frontmatter 존재 및 필수 필드
- 노드 ID 규칙 (kebab-case, 최대 50자, 유일)
- 데드 링크 (존재하지 않는 노드 참조)
- 고아 노드 (어디서도 참조되지 않는 비시작 노드)
- 순환 감지 (DFS)
"""

import re
import sys
from pathlib import Path

ID_PATTERN = re.compile(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
NODE_HEADER = re.compile(r'^## `([^`]+)`\s+(.+)', re.MULTILINE)
CHOICE_LINK = re.compile(r'- \[.+?\]\(#([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)')


def parse_tree(text):
    # frontmatter
    fm_match = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
    if not fm_match:
        return None, None, ['YAML frontmatter가 없습니다.']

    fm = {}
    for line in fm_match.group(1).split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            fm[k.strip()] = v.strip()

    errors = []
    for field in ('title', 'version', 'start'):
        if field not in fm:
            errors.append(f'frontmatter에 "{field}" 필드가 없습니다.')

    # nodes
    nodes = {}  # id -> list of target ids
    seen_ids = []
    for m in NODE_HEADER.finditer(text):
        nid = m.group(1)
        if not ID_PATTERN.match(nid):
            errors.append(f'잘못된 노드 ID: "{nid}"')
        if len(nid) > 50:
            errors.append(f'노드 ID가 50자 초과: "{nid}"')
        if nid in nodes:
            errors.append(f'중복 노드 ID: "{nid}"')
        seen_ids.append(nid)

        # find section content until next ## or end
        start = m.end()
        next_header = re.search(r'^## ', text[start:], re.MULTILINE)
        section = text[start:start + next_header.start()] if next_header else text[start:]
        targets = CHOICE_LINK.findall(section)
        nodes[nid] = targets

    return fm, nodes, errors


def check_dead_links(nodes, errors):
    all_ids = set(nodes.keys())
    for nid, targets in nodes.items():
        for t in targets:
            if t not in all_ids:
                errors.append(f'데드 링크: "{nid}" → "{t}"')


def check_orphans(fm, nodes, errors):
    referenced = set()
    if fm.get('start'):
        referenced.add(fm['start'])
    for targets in nodes.values():
        referenced.update(targets)
    for nid in nodes:
        if nid not in referenced:
            errors.append(f'고아 노드: "{nid}" (어디서도 참조되지 않음)')


def check_cycles(nodes, errors):
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in nodes}
    path = []

    def dfs(u):
        color[u] = GRAY
        path.append(u)
        for v in nodes.get(u, []):
            if v not in color:
                continue
            if color[v] == GRAY:
                cycle = path[path.index(v):] + [v]
                errors.append(f'순환 감지: {" → ".join(cycle)}')
                return
            if color[v] == WHITE:
                dfs(v)
        path.pop()
        color[u] = BLACK

    for n in nodes:
        if color[n] == WHITE:
            dfs(n)


def main():
    readme = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('README.md')
    if not readme.exists():
        print(f'FAIL: {readme} 파일을 찾을 수 없습니다.')
        sys.exit(1)

    text = readme.read_text(encoding='utf-8')
    fm, nodes, errors = parse_tree(text)

    if nodes is not None:
        check_dead_links(nodes, errors)
        check_orphans(fm, nodes, errors)
        check_cycles(nodes, errors)

    if errors:
        print('FAIL:')
        for e in errors:
            print(f'  - {e}')
        sys.exit(1)
    else:
        print(f'PASS: {len(nodes)}개 노드, 모든 검증 통과')
        sys.exit(0)


if __name__ == '__main__':
    main()
