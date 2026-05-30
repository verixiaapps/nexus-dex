FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

RUN apt-get update \
 && export DEBIAN_FRONTEND=noninteractive \
 && apt-get install -y --no-install-recommends \
      build-essential libssl-dev pkg-config libudev-dev curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

USER vscode
ENV HOME=/home/vscode

RUN sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
ENV PATH="/home/vscode/.local/share/solana/install/active_release/bin:${PATH}"

RUN cargo install --git https://github.com/coral-xyz/anchor avm --force \
 && avm install latest \
 && avm use latest
ENV PATH="/home/vscode/.avm/bin:${PATH}"
