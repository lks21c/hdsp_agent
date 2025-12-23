#!/usr/bin/env python3
"""
RAG 디버깅 CLI 스크립트.

RAG 검색 파이프라인의 전체 리니지를 추적하여 디버깅 정보를 출력합니다.

사용 예시:
    python -m scripts.debug_rag "pandas로 데이터프레임 만들어줘"
    python -m scripts.debug_rag "시각화 코드" --libs matplotlib seaborn
    python -m scripts.debug_rag "test query" --top-k 10 --verbose
    python -m scripts.debug_rag "test query" --json
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


def print_header(title: str, width: int = 80) -> None:
    """Print a formatted header."""
    print("=" * width)
    print(f" {title}")
    print("=" * width)


def print_subheader(title: str, width: int = 80) -> None:
    """Print a formatted subheader."""
    print("-" * width)
    print(f" {title}")
    print("-" * width)


async def run_debug_search(
    query: str,
    imported_libraries: List[str],
    top_k: Optional[int],
    verbose: bool,
    json_output: bool,
    include_full_content: bool,
) -> None:
    """Run debug search and print results."""
    from agent_server.core.rag_manager import get_rag_manager
    from agent_server.schemas.rag import get_default_rag_config

    # Initialize RAG manager
    config = get_default_rag_config()
    rag_manager = get_rag_manager(config)

    # Initialize if not ready
    if not rag_manager.is_ready:
        print("Initializing RAG system...")
        success = await rag_manager.initialize()
        if not success:
            print("ERROR: Failed to initialize RAG system")
            sys.exit(1)
        print("RAG system initialized.\n")

    # Run debug search
    result = await rag_manager.debug_search(
        query=query,
        imported_libraries=imported_libraries if imported_libraries else None,
        top_k=top_k,
        include_full_content=include_full_content,
        simulate_plan_context=True,
    )

    # JSON output mode
    if json_output:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    # Formatted output
    print_header("RAG DEBUG RESULTS")
    print()

    # Query info
    lib_detection = result["library_detection"]
    print(f"Query: {lib_detection['input_query']}")
    imported = lib_detection["imported_libraries"]
    print(f"Imported Libraries: {imported if imported else '(none)'}")
    print(f"Detected Libraries: {lib_detection['detected_libraries']}")
    print(f"Detection Method: {lib_detection['detection_method']}")
    print()

    # Search configuration
    print_header("SEARCH CONFIGURATION")
    config_info = result["config"]
    print(f"  top_k: {config_info['top_k']}")
    print(f"  score_threshold: {config_info['score_threshold']}")
    print(f"  max_context_tokens: {config_info['max_context_tokens']}")
    print()

    # Timing info
    print_header("TIMING")
    print(f"  Vector search: {result['search_ms']:.2f} ms")
    print()

    # Retrieved chunks
    print_header("RETRIEVED CHUNKS")
    print(f"Total candidates: {result['total_candidates']}")
    print(f"Passed threshold: {result['total_passed_threshold']}")
    print()

    # Chunks table
    print(f" {'Rank':>4}  {'Score':>7}  {'Pass':>4}   Source")
    print("-" * 70)

    for chunk in result["chunks"]:
        source = chunk["metadata"].get("source", "unknown")
        section = chunk["metadata"].get("section", "")
        source_display = source
        if section:
            source_display += f" > {section}"

        passed = "YES" if chunk["passed_threshold"] else "NO"
        print(
            f" {chunk['rank']:>4}  {chunk['score']:>7.4f}  {passed:>4}   {source_display}"
        )

    if verbose:
        print()
        print_subheader("CHUNK DETAILS")
        for i, chunk in enumerate(result["chunks"]):
            print(f"\n[Chunk {i + 1}] ID: {chunk['chunk_id']}")
            print(f"  Rank: {chunk['rank']}")
            print(f"  Score: {chunk['score']:.4f}")
            print(f"  Passed: {chunk['passed_threshold']}")
            print("  Content Preview:")
            preview = chunk["content_preview"]
            # Indent preview lines
            for line in preview.split("\n")[:5]:
                print(f"    {line[:100]}")
            if len(preview.split("\n")) > 5:
                print("    ...")

    print()
    print_header("FORMATTED CONTEXT")
    print(f"Character count: {result['context_char_count']}")
    print(f"Estimated tokens: {result['estimated_context_tokens']}")
    print()

    if result["formatted_context"]:
        print(result["formatted_context"])
    else:
        print("(No context generated - no chunks passed threshold)")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="RAG Debug Tool - Trace the full retrieval pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m scripts.debug_rag "pandas로 데이터프레임 만들어줘"
  python -m scripts.debug_rag "시각화 코드" --libs matplotlib seaborn
  python -m scripts.debug_rag "test query" --top-k 10 --verbose
  python -m scripts.debug_rag "test query" --json
        """,
    )

    parser.add_argument("query", type=str, help="Search query to debug")
    parser.add_argument(
        "--libs",
        "-l",
        nargs="+",
        default=[],
        metavar="LIB",
        help="Imported libraries to simulate (e.g., --libs pandas numpy)",
    )
    parser.add_argument(
        "--top-k",
        "-k",
        type=int,
        default=None,
        help="Number of chunks to retrieve (default: from config)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show detailed chunk information"
    )
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    parser.add_argument(
        "--full-content",
        action="store_true",
        help="Include full chunk content instead of preview",
    )

    args = parser.parse_args()

    # Run async function
    asyncio.run(
        run_debug_search(
            query=args.query,
            imported_libraries=args.libs,
            top_k=args.top_k,
            verbose=args.verbose,
            json_output=args.json,
            include_full_content=args.full_content,
        )
    )


if __name__ == "__main__":
    main()
