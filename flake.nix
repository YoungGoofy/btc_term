{
  description = "CUDA development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config = {
        allowUnfree = true;
        cudaSupport = true;
        cudaVersion = "12";
      };
    };
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = with pkgs; [
        # --- CUDA пакеты ---
        cudatoolkit
        cudaPackages.cudnn
        cudaPackages.cuda_cudart

        # --- Базовые утилиты для сборки/разработки ---
        stdenv.cc
        binutils
        zlib
        ffmpeg
        uv

        # --- Графические библиотеки (если нужен рендер/gui) ---
        libGLU
        libGL
        xorg.libXi
        xorg.libXmu
        freeglut
        xorg.libXext
        xorg.libX11
        xorg.libXv
        xorg.libXrandr
        ncurses
      ];

      shellHook = ''
        # ВАЖНО: Берем драйвер из системы, чтобы не было конфликта с твоим production-драйвером
        export LD_LIBRARY_PATH="/run/opengl-driver/lib:/run/opengl-driver-32/lib:$LD_LIBRARY_PATH"
        export CUDA_PATH="${pkgs.cudatoolkit}"

        # Флаги для компиляторов
        export EXTRA_LDFLAGS="-L/lib"
        export EXTRA_CCFLAGS="-I/usr/include"
      '';
    };
  };
}
