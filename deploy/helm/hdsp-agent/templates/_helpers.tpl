{{/*
Expand the name of the chart.
*/}}
{{- define "hdsp-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "hdsp-agent.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "hdsp-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "hdsp-agent.labels" -}}
helm.sh/chart: {{ include "hdsp-agent.chart" . }}
{{ include "hdsp-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "hdsp-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hdsp-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Agent Server labels
*/}}
{{- define "hdsp-agent.agentServer.labels" -}}
{{ include "hdsp-agent.labels" . }}
app.kubernetes.io/component: agent-server
{{- end }}

{{/*
Agent Server selector labels
*/}}
{{- define "hdsp-agent.agentServer.selectorLabels" -}}
{{ include "hdsp-agent.selectorLabels" . }}
app.kubernetes.io/component: agent-server
{{- end }}

{{/*
Qdrant labels
*/}}
{{- define "hdsp-agent.qdrant.labels" -}}
{{ include "hdsp-agent.labels" . }}
app.kubernetes.io/component: qdrant
{{- end }}

{{/*
Qdrant selector labels
*/}}
{{- define "hdsp-agent.qdrant.selectorLabels" -}}
{{ include "hdsp-agent.selectorLabels" . }}
app.kubernetes.io/component: qdrant
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "hdsp-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "hdsp-agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Qdrant service name
*/}}
{{- define "hdsp-agent.qdrant.serviceName" -}}
{{- printf "%s-qdrant" (include "hdsp-agent.fullname" .) }}
{{- end }}

{{/*
Agent Server service name
*/}}
{{- define "hdsp-agent.agentServer.serviceName" -}}
{{- printf "%s-agent-server" (include "hdsp-agent.fullname" .) }}
{{- end }}
