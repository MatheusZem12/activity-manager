# Imagem do backend, em dois estágios.
#
# O estágio de build carrega Maven e o JDK inteiro; o final leva só a JRE e o
# jar. O que não está na imagem final não pode ser explorado nela.

# ---------------------------------------------------------------- construção
FROM maven:3.9-eclipse-temurin-21 AS construcao
WORKDIR /obra

# O pom sozinho primeiro: enquanto as dependências não mudam, esta camada é
# reaproveitada e um rebuild de código não baixa a internet de novo.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q package -DskipTests

# -------------------------------------------------------------------- runtime
FROM eclipse-temurin:21-jre-noble AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Usuário sem privilégio. O processo não precisa de root para nada, e um
# servidor exposto na internet é exatamente onde isso importa.
RUN useradd --system --create-home --uid 10001 activity

WORKDIR /app
COPY --from=construcao /obra/target/*.jar app.jar
RUN chown -R activity:activity /app
USER activity

ENV AM_PORTA=8090 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC"

EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD curl -fsS http://127.0.0.1:8090/api/saude || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
