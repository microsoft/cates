{{/* Common helpers for the cates chart */}}

{{- define "cates.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cates.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "cates.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "cates.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "cates.labels" -}}
helm.sh/chart: {{ include "cates.chart" . }}
{{ include "cates.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "cates.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cates.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "cates.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "cates.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "cates.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* Reusable podSpec used by both Job and CronJob */}}
{{- define "cates.podSpec" -}}
serviceAccountName: {{ include "cates.serviceAccountName" . }}
restartPolicy: {{ .Values.job.restartPolicy }}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
securityContext:
  {{- toYaml .Values.podSecurityContext | nindent 2 }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
containers:
  - name: cates
    image: {{ include "cates.image" . | quote }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    args:
      {{- toYaml .Values.args | nindent 6 }}
    securityContext:
      {{- toYaml .Values.securityContext | nindent 6 }}
    env:
      {{- if and .Values.githubToken.workloadIdentity.enabled (not (or .Values.githubToken.value .Values.githubToken.existingSecret)) }}
      - name: GH_HOST
        value: github.com
      {{- end }}
      {{- if or .Values.githubToken.value .Values.githubToken.existingSecret }}
      - name: GH_TOKEN
        valueFrom:
          secretKeyRef:
            name: {{ if .Values.githubToken.existingSecret }}{{ .Values.githubToken.existingSecret }}{{ else }}{{ include "cates.fullname" . }}-gh{{ end }}
            key: {{ .Values.githubToken.existingSecretKey | default "token" }}
      {{- end }}
      {{- with .Values.env }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
    resources:
      {{- toYaml .Values.resources | nindent 6 }}
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: home
        mountPath: /home/cates
      {{- if .Values.policy.enabled }}
      - name: policy
        mountPath: /etc/cates
        readOnly: true
      {{- end }}
      {{- if .Values.repos.enabled }}
      - name: repos
        mountPath: /etc/cates-repos
        readOnly: true
      {{- end }}
      {{- if .Values.reports.persistence.enabled }}
      - name: reports
        mountPath: {{ .Values.reports.mountPath }}
      {{- end }}
volumes:
  - name: tmp
    emptyDir: {}
  - name: home
    emptyDir: {}
  {{- if .Values.policy.enabled }}
  - name: policy
    configMap:
      name: {{ include "cates.fullname" . }}-policy
  {{- end }}
  {{- if .Values.repos.enabled }}
  - name: repos
    configMap:
      name: {{ include "cates.fullname" . }}-repos
  {{- end }}
  {{- if .Values.reports.persistence.enabled }}
  - name: reports
    persistentVolumeClaim:
      claimName: {{ .Values.reports.persistence.existingClaim | default (printf "%s-reports" (include "cates.fullname" .)) }}
  {{- end }}
{{- end -}}
