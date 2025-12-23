"""
Summary Generator - 템플릿 기반 최종 요약 생성
LLM 호출 없이 실행 단계와 출력을 분석하여 요약 생성
토큰 절약: ~300-500 토큰/세션
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional


class TaskType(Enum):
    """작업 유형"""

    DATA_LOAD = "data_load"
    VISUALIZATION = "visualization"
    EDA = "eda"
    PREPROCESSING = "preprocessing"
    MODELING = "modeling"
    ANALYSIS = "analysis"
    GENERAL = "general"


@dataclass
class SummaryMetrics:
    """요약에 사용되는 메트릭"""

    task_type: TaskType
    step_count: int
    rows: Optional[int] = None
    cols: Optional[int] = None
    filename: Optional[str] = None
    chart_count: Optional[int] = None
    chart_types: Optional[List[str]] = None
    findings: Optional[List[str]] = None
    model_name: Optional[str] = None
    accuracy: Optional[float] = None
    extra_info: Optional[str] = None


class SummaryGenerator:
    """
    템플릿 기반 요약 생성기 (LLM 호출 없음)
    실행된 단계와 출력을 분석하여 한국어 요약 자동 생성
    """

    # 작업 유형별 템플릿
    TEMPLATES: Dict[TaskType, str] = {
        TaskType.DATA_LOAD: "{filename} 데이터를 로드하여 {rows}행 {cols}열 확인 완료.",
        TaskType.VISUALIZATION: "{chart_types} 시각화 {chart_count}개 생성 완료.",
        TaskType.EDA: "탐색적 데이터 분석 완료: {findings}",
        TaskType.PREPROCESSING: "데이터 전처리 완료: {extra_info}",
        TaskType.MODELING: "{model_name} 모델 학습 완료. {extra_info}",
        TaskType.ANALYSIS: "분석 완료: {extra_info}",
        TaskType.GENERAL: "요청하신 작업을 {step_count}단계로 완료했습니다.",
    }

    # 작업 유형 감지 키워드
    TASK_KEYWORDS: Dict[TaskType, List[str]] = {
        TaskType.DATA_LOAD: [
            "read_csv",
            "read_excel",
            "read_parquet",
            "read_json",
            "load",
            "로드",
            "불러오기",
            "pd.read",
            "dd.read",
            "pl.read",
        ],
        TaskType.VISUALIZATION: [
            "plot",
            "plt.",
            "fig",
            "chart",
            "graph",
            "histogram",
            "scatter",
            "시각화",
            "그래프",
            "차트",
            "sns.",
            "seaborn",
            "matplotlib",
            "barplot",
            "lineplot",
            "heatmap",
            "boxplot",
        ],
        TaskType.EDA: [
            "describe",
            "info",
            "shape",
            "head",
            "value_counts",
            "EDA",
            "탐색",
            "분포",
            "correlation",
            "상관관계",
            "summary",
        ],
        TaskType.PREPROCESSING: [
            "fillna",
            "dropna",
            "merge",
            "concat",
            "transform",
            "encode",
            "전처리",
            "정제",
            "normalize",
            "standardize",
            "clean",
            "impute",
        ],
        TaskType.MODELING: [
            "fit",
            "train",
            "model",
            "predict",
            "sklearn",
            "xgboost",
            "모델",
            "학습",
            "예측",
            "classifier",
            "regressor",
            "RandomForest",
        ],
    }

    # 출력에서 메트릭 추출 패턴
    METRIC_PATTERNS = {
        "rows_cols": [
            r"(\d+)\s*rows?\s*[x×]\s*(\d+)\s*col",
            r"\((\d+),\s*(\d+)\)",
            r"(\d+)행\s*(\d+)열",
            r"shape:\s*\((\d+),\s*(\d+)\)",
        ],
        "filename": [
            r"['\"]([^'\"]+\.(?:csv|xlsx|parquet|json))['\"]",
            r'read_\w+\s*\(\s*["\']([^"\']+)["\']',
        ],
        "accuracy": [
            r"accuracy[:\s]*([0-9.]+)",
            r"정확도[:\s]*([0-9.]+)",
            r"score[:\s]*([0-9.]+)",
        ],
    }

    # 차트 유형 매핑
    CHART_TYPE_MAP = {
        "histogram": "히스토그램",
        "scatter": "산점도",
        "bar": "막대그래프",
        "line": "라인그래프",
        "box": "박스플롯",
        "heatmap": "히트맵",
        "pie": "파이차트",
        "area": "영역그래프",
        "violin": "바이올린플롯",
    }

    def __init__(self, max_length: int = 200):
        """
        Args:
            max_length: 요약 최대 길이 (기본값: 200자)
        """
        self.max_length = max_length

    def generate(
        self,
        original_request: str,
        executed_steps: List[Dict[str, Any]],
        outputs: List[Any],
    ) -> str:
        """
        실행 결과에서 요약 생성

        Args:
            original_request: 원래 사용자 요청
            executed_steps: 실행된 단계 목록
            outputs: 실행 결과 출력 목록

        Returns:
            생성된 요약 문자열 (200자 이내)
        """
        # 1. 메트릭 추출
        metrics = self._extract_metrics(executed_steps, outputs, original_request)

        # 2. 템플릿 기반 요약 생성
        summary = self._generate_from_template(metrics)

        # 3. 길이 제한 적용
        if len(summary) > self.max_length:
            summary = summary[: self.max_length - 3] + "..."

        return summary

    def _extract_metrics(
        self, executed_steps: List[Dict[str, Any]], outputs: List[Any], request: str
    ) -> SummaryMetrics:
        """실행 결과에서 메트릭 추출"""
        # 단계 설명과 코드 결합
        all_text = request + " "
        step_codes = []

        for step in executed_steps:
            desc = step.get("description", "")
            all_text += desc + " "

            # toolCalls에서 코드 추출
            tool_calls = step.get("toolCalls", [])
            for tc in tool_calls:
                if tc.get("tool") == "jupyter_cell":
                    code = tc.get("parameters", {}).get("code", "")
                    all_text += code + " "
                    step_codes.append(code)

        # 출력 텍스트
        output_text = " ".join([str(o)[:500] for o in outputs])
        all_text += output_text

        # 작업 유형 감지
        task_type = self._detect_task_type(all_text, step_codes)

        # 기본 메트릭
        metrics = SummaryMetrics(task_type=task_type, step_count=len(executed_steps))

        # 데이터 크기 추출
        rows, cols = self._extract_data_shape(all_text + output_text)
        if rows:
            metrics.rows = rows
            metrics.cols = cols

        # 파일명 추출
        filename = self._extract_filename(all_text)
        if filename:
            metrics.filename = filename

        # 차트 정보 추출 (시각화 작업)
        if task_type == TaskType.VISUALIZATION:
            chart_types, chart_count = self._extract_chart_info(all_text)
            metrics.chart_types = chart_types
            metrics.chart_count = chart_count

        # 모델 정보 추출
        if task_type == TaskType.MODELING:
            metrics.model_name = self._extract_model_name(all_text)
            accuracy = self._extract_accuracy(output_text)
            if accuracy:
                metrics.accuracy = accuracy
                metrics.extra_info = f"정확도 {accuracy:.2%}"

        # EDA 발견사항
        if task_type == TaskType.EDA:
            metrics.findings = self._extract_eda_findings(executed_steps)

        # 전처리 정보
        if task_type == TaskType.PREPROCESSING:
            metrics.extra_info = self._extract_preprocessing_info(all_text)

        # 일반 분석 정보
        if task_type == TaskType.ANALYSIS:
            metrics.extra_info = self._summarize_steps(executed_steps)

        return metrics

    def _detect_task_type(self, text: str, codes: List[str]) -> TaskType:
        """작업 유형 감지"""
        text_lower = text.lower()
        code_text = " ".join(codes).lower()

        # 우선순위: 코드 기반 → 텍스트 기반
        scores: Dict[TaskType, int] = {t: 0 for t in TaskType}

        for task_type, keywords in self.TASK_KEYWORDS.items():
            for keyword in keywords:
                keyword_lower = keyword.lower()
                # 코드에서 발견되면 가중치 높음
                if keyword_lower in code_text:
                    scores[task_type] += 3
                # 텍스트에서 발견
                elif keyword_lower in text_lower:
                    scores[task_type] += 1

        # 최고 점수 작업 유형 반환
        max_score = max(scores.values())
        if max_score > 0:
            for task_type, score in scores.items():
                if score == max_score:
                    return task_type

        return TaskType.GENERAL

    def _extract_data_shape(self, text: str) -> tuple:
        """데이터 크기 (rows, cols) 추출"""
        for pattern in self.METRIC_PATTERNS["rows_cols"]:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    rows = int(match.group(1))
                    cols = int(match.group(2))
                    return rows, cols
                except (ValueError, IndexError):
                    continue
        return None, None

    def _extract_filename(self, text: str) -> Optional[str]:
        """파일명 추출"""
        for pattern in self.METRIC_PATTERNS["filename"]:
            match = re.search(pattern, text)
            if match:
                filename = match.group(1)
                # 경로에서 파일명만 추출
                if "/" in filename:
                    filename = filename.split("/")[-1]
                return filename
        return None

    def _extract_chart_info(self, text: str) -> tuple:
        """차트 정보 추출"""
        text_lower = text.lower()
        detected_types = []

        for eng_name, kor_name in self.CHART_TYPE_MAP.items():
            if eng_name in text_lower or kor_name in text_lower:
                if kor_name not in detected_types:
                    detected_types.append(kor_name)

        # plt.show() 또는 fig 개수로 차트 수 추정
        show_count = len(re.findall(r"plt\.show\(\)|\.show\(\)", text))
        fig_count = len(
            re.findall(r"plt\.figure|fig\s*[,=]|subplots", text, re.IGNORECASE)
        )
        chart_count = max(show_count, fig_count, len(detected_types), 1)

        if not detected_types:
            detected_types = ["차트"]

        return detected_types, chart_count

    def _extract_model_name(self, text: str) -> str:
        """모델명 추출"""
        model_patterns = [
            (r"RandomForest\w*", "RandomForest"),
            (r"XGBoost\w*", "XGBoost"),
            (r"LogisticRegression", "LogisticRegression"),
            (r"LinearRegression", "LinearRegression"),
            (r"DecisionTree\w*", "DecisionTree"),
            (r"SVM|SVC|SVR", "SVM"),
            (r"KNN|KNeighbors\w*", "KNN"),
            (r"GradientBoosting\w*", "GradientBoosting"),
            (r"LightGBM|lgb\.", "LightGBM"),
            (r"CatBoost", "CatBoost"),
            (r"Neural|MLP|keras|tensorflow|torch", "NeuralNetwork"),
        ]

        for pattern, name in model_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return name

        return "ML"

    def _extract_accuracy(self, text: str) -> Optional[float]:
        """정확도/점수 추출"""
        for pattern in self.METRIC_PATTERNS["accuracy"]:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    value = float(match.group(1))
                    # 0-1 범위로 정규화
                    if value > 1:
                        value = value / 100
                    return value
                except ValueError:
                    continue
        return None

    def _extract_eda_findings(self, steps: List[Dict]) -> List[str]:
        """EDA 발견사항 추출"""
        findings = []

        for step in steps:
            desc = step.get("description", "").lower()

            if "분포" in desc:
                findings.append("분포 분석")
            if "상관" in desc or "correlation" in desc:
                findings.append("상관관계 분석")
            if "결측" in desc or "missing" in desc or "null" in desc:
                findings.append("결측치 확인")
            if "이상" in desc or "outlier" in desc:
                findings.append("이상치 확인")
            if "describe" in desc or "통계" in desc:
                findings.append("기술 통계")

        return findings[:3] if findings else ["데이터 탐색"]

    def _extract_preprocessing_info(self, text: str) -> str:
        """전처리 정보 추출"""
        operations = []

        if "fillna" in text or "결측" in text:
            operations.append("결측치 처리")
        if "dropna" in text or "drop" in text:
            operations.append("데이터 제거")
        if "merge" in text or "concat" in text:
            operations.append("데이터 병합")
        if "encode" in text or "LabelEncoder" in text or "OneHot" in text:
            operations.append("인코딩")
        if "scale" in text or "normalize" in text or "StandardScaler" in text:
            operations.append("스케일링")

        return ", ".join(operations) if operations else "데이터 정제"

    def _summarize_steps(self, steps: List[Dict]) -> str:
        """단계 요약"""
        descriptions = [s.get("description", "")[:30] for s in steps[:3]]
        return ", ".join(d for d in descriptions if d)

    def _generate_from_template(self, metrics: SummaryMetrics) -> str:
        """템플릿 기반 요약 생성"""
        template = self.TEMPLATES[metrics.task_type]

        try:
            if metrics.task_type == TaskType.DATA_LOAD:
                return template.format(
                    filename=metrics.filename or "데이터",
                    rows=metrics.rows or "?",
                    cols=metrics.cols or "?",
                )

            elif metrics.task_type == TaskType.VISUALIZATION:
                chart_str = (
                    ", ".join(metrics.chart_types[:3])
                    if metrics.chart_types
                    else "차트"
                )
                return template.format(
                    chart_types=chart_str, chart_count=metrics.chart_count or 1
                )

            elif metrics.task_type == TaskType.EDA:
                findings_str = (
                    ", ".join(metrics.findings[:3])
                    if metrics.findings
                    else "데이터 탐색"
                )
                return template.format(findings=findings_str)

            elif metrics.task_type == TaskType.PREPROCESSING:
                return template.format(extra_info=metrics.extra_info or "데이터 정제")

            elif metrics.task_type == TaskType.MODELING:
                extra = metrics.extra_info or ""
                return template.format(
                    model_name=metrics.model_name or "ML", extra_info=extra
                )

            elif metrics.task_type == TaskType.ANALYSIS:
                return template.format(extra_info=metrics.extra_info or "분석 수행")

            else:  # GENERAL
                return template.format(step_count=metrics.step_count)

        except KeyError:
            # 템플릿 포맷 실패 시 기본 메시지
            return f"요청하신 작업을 {metrics.step_count}단계로 완료했습니다."


# 싱글톤 인스턴스
_summary_generator_instance: Optional[SummaryGenerator] = None


def get_summary_generator() -> SummaryGenerator:
    """싱글톤 SummaryGenerator 반환"""
    global _summary_generator_instance
    if _summary_generator_instance is None:
        _summary_generator_instance = SummaryGenerator()
    return _summary_generator_instance
