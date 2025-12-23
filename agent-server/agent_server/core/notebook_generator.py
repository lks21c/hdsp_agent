"""
Notebook Generator - Creates Jupyter notebooks from prompts using LLM
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


class NotebookGenerator:
    """Generate Jupyter notebooks from natural language prompts"""

    def __init__(self, llm_service, task_manager):
        self.llm_service = llm_service
        self.task_manager = task_manager

    def _extract_json_from_response(self, response_text: str) -> Optional[Dict]:
        """Extract JSON object from LLM response text"""
        content = response_text.strip()
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                return None
        return None

    async def _call_llm_for_json(self, prompt: str, fallback: dict) -> dict:
        """Call LLM and extract JSON response, with fallback"""
        response_text = await self.llm_service.generate_response(prompt)
        result = self._extract_json_from_response(response_text)
        return result if result else fallback

    def _remove_code_block_markers(self, content: str) -> str:
        """Remove markdown code block markers from content"""
        content = re.sub(r"^```python\n", "", content)
        content = re.sub(r"^```\n", "", content)
        content = re.sub(r"\n```$", "", content)
        return content.strip()

    async def generate_notebook(
        self, task_id: str, prompt: str, output_dir: str = None
    ) -> str:
        """
        Generate a notebook from a prompt

        Args:
            task_id: Task ID for progress tracking
            prompt: Natural language prompt for notebook generation
            output_dir: Directory to save the notebook (default: current directory)

        Returns:
            Path to generated notebook
        """
        try:
            self.task_manager.start_task(task_id)

            # Step 1: Analyze prompt (10%)
            self.task_manager.update_progress(task_id, 10, "프롬프트 분석 중...")
            analysis = await self._analyze_prompt(prompt)

            # Step 2: Generate notebook structure (20%)
            self.task_manager.update_progress(task_id, 20, "노트북 구조 생성 중...")
            notebook_plan = await self._create_notebook_plan(prompt, analysis)

            # Step 3: Generate cells (30-80%)
            self.task_manager.update_progress(task_id, 30, "셀 생성 중...")
            cells = await self._generate_cells(task_id, notebook_plan)

            # Step 4: Create notebook file (90%)
            self.task_manager.update_progress(task_id, 90, "노트북 저장 중...")
            notebook_path = await self._save_notebook(
                cells, output_dir, analysis.get("title", "generated")
            )

            # Step 5: Complete (100%)
            self.task_manager.complete_task(task_id, notebook_path)

            return notebook_path

        except Exception as e:
            self.task_manager.fail_task(task_id, str(e))
            raise

    async def _analyze_prompt(self, prompt: str) -> Dict[str, Any]:
        """Analyze the prompt to understand requirements"""
        analysis_prompt = f"""다음 요청을 분석하고 JSON 형식으로 응답해주세요:

요청: {prompt}

다음 정보를 추출해주세요:
1. 노트북 제목 (title)
2. 주요 작업 목표 (objective)
3. 사용할 라이브러리들 (libraries) - 배열
4. 예상되는 셀 개수 (estimated_cells)
5. 데이터 분석 유형 (analysis_type: exploration, modeling, visualization, etc.)

JSON만 응답하세요:"""

        fallback = {
            "title": "Generated Notebook",
            "objective": prompt,
            "libraries": ["pandas", "numpy"],
            "estimated_cells": 10,
            "analysis_type": "general",
        }
        return await self._call_llm_for_json(analysis_prompt, fallback)

    async def _create_notebook_plan(
        self, prompt: str, analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create a structured plan for the notebook"""
        plan_prompt = f"""다음 요청에 대한 Jupyter 노트북 계획을 작성해주세요:

요청: {prompt}

분석 결과:
- 목표: {analysis['objective']}
- 라이브러리: {', '.join(analysis['libraries'])}
- 분석 유형: {analysis['analysis_type']}

노트북의 각 셀에 대한 계획을 JSON 형식으로 작성해주세요:
{{
  "cells": [
    {{
      "type": "markdown",
      "purpose": "제목 및 개요",
      "content_hint": "간단한 설명"
    }},
    {{
      "type": "code",
      "purpose": "라이브러리 임포트",
      "content_hint": "import 문들"
    }},
    ...
  ]
}}

JSON만 응답하세요:"""

        fallback = {
            "cells": [
                {
                    "type": "markdown",
                    "purpose": "제목",
                    "content_hint": analysis["title"],
                },
                {
                    "type": "code",
                    "purpose": "라이브러리 임포트",
                    "content_hint": "import pandas, numpy",
                },
                {"type": "code", "purpose": "데이터 로드", "content_hint": "load data"},
                {"type": "code", "purpose": "분석", "content_hint": "analysis code"},
            ]
        }
        return await self._call_llm_for_json(plan_prompt, fallback)

    async def _generate_cells(
        self, task_id: str, plan: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Generate actual cell content based on plan"""
        cells = []
        planned_cells = plan.get("cells", [])
        total_cells = len(planned_cells)

        for idx, cell_plan in enumerate(planned_cells):
            # Update progress (30% -> 80%)
            progress = 30 + int((idx / total_cells) * 50)
            self.task_manager.update_progress(
                task_id, progress, f"셀 생성 중... ({idx+1}/{total_cells})"
            )

            cell_type = cell_plan.get("type", "code")
            purpose = cell_plan.get("purpose", "")
            content_hint = cell_plan.get("content_hint", "")

            if cell_type == "markdown":
                content = await self._generate_markdown_cell(purpose, content_hint)
            else:
                content = await self._generate_code_cell(purpose, content_hint)

            # Jupyter notebook source requires each line to end with \n (except the last line)
            lines = content.split("\n")
            source_lines = (
                [line + "\n" for line in lines[:-1]] + [lines[-1]] if lines else []
            )

            cells.append(
                {"cell_type": cell_type, "metadata": {}, "source": source_lines}
            )

            # Add execution_count for code cells
            if cell_type == "code":
                cells[-1]["execution_count"] = None
                cells[-1]["outputs"] = []

        return cells

    async def _generate_markdown_cell(self, purpose: str, hint: str) -> str:
        """Generate markdown cell content"""
        prompt = f"""다음 Jupyter 노트북 마크다운 셀을 작성해주세요:

목적: {purpose}
힌트: {hint}

마크다운만 작성하고, 코드 블록이나 다른 설명 없이 내용만 응답하세요:"""

        response_text = await self.llm_service.generate_response(prompt)
        return response_text.strip()

    async def _generate_code_cell(self, purpose: str, hint: str) -> str:
        """Generate code cell content"""
        prompt = f"""다음 Jupyter 노트북 코드 셀을 작성해주세요:

목적: {purpose}
힌트: {hint}

실행 가능한 Python 코드만 작성하고, 설명이나 마크다운 없이 코드만 응답하세요.
주석은 한국어로 간단히 작성하세요:"""

        response_text = await self.llm_service.generate_response(prompt)
        return self._remove_code_block_markers(response_text.strip())

    async def _save_notebook(
        self, cells: List[Dict], output_dir: str, base_name: str
    ) -> str:
        """Save notebook to file"""
        # Prepare output directory
        if output_dir is None:
            output_dir = os.getcwd()

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = re.sub(r"[^\w\s-]", "", base_name)
        safe_name = re.sub(r"[\s_]+", "_", safe_name)
        filename = f"{safe_name}_{timestamp}.ipynb"

        notebook_path = output_path / filename

        # Create notebook structure
        notebook = {
            "cells": cells,
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3",
                },
                "language_info": {
                    "codemirror_mode": {"name": "ipython", "version": 3},
                    "file_extension": ".py",
                    "mimetype": "text/x-python",
                    "name": "python",
                    "nbconvert_exporter": "python",
                    "pygments_lexer": "ipython3",
                    "version": "3.8.0",
                },
            },
            "nbformat": 4,
            "nbformat_minor": 4,
        }

        # Save to file
        with open(notebook_path, "w", encoding="utf-8") as f:
            json.dump(notebook, f, indent=2, ensure_ascii=False)

        return str(notebook_path)
