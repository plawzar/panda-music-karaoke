"""Run the existing UVR MDX separator with ONNX Runtime DirectML on Windows."""

import logging
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

logger = logging.getLogger(__name__)


def separate_vocals(audio_path: str, model_file: str, output_dir: Path, *, scratch_dir: Path | None = None) -> str:
    import onnxruntime as ort
    from audio_separator.separator import Separator

    class MdxSeparator(Separator):
        def load_model_data_using_hash(self, model_path):
            model_data = super().load_model_data_using_hash(model_path)
            # Matching the training window keeps MDX on its ONNX path.
            self.arch_specific_params["MDX"]["segment_size"] = 2 ** model_data["mdx_dim_t_set"]
            return model_data

    with TemporaryDirectory(prefix="panda-vocals-", dir=scratch_dir or output_dir) as temporary:
        separator = MdxSeparator(
            output_dir=temporary,
            output_format="WAV",
            output_single_stem="Vocals",
            normalization_threshold=0.9,
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.25, "batch_size": 1},
        )
        separator.load_model(model_filename=model_file)
        mdx = separator.model_instance
        model_path = mdx.model_path

        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        cpu_provider = "CPUExecutionProvider"
        gpu_provider = "DmlExecutionProvider"
        providers = [cpu_provider]
        if gpu_provider in ort.get_available_providers():
            device_id = int(os.environ.get("PANDA_DIRECTML_DEVICE_ID", "0"))
            providers.insert(0, (gpu_provider, {"device_id": device_id}))

        def cpu_session():
            return ort.InferenceSession(model_path, sess_options=options, providers=[cpu_provider])

        try:
            session = ort.InferenceSession(model_path, sess_options=options, providers=providers)
        except Exception:
            if providers == [cpu_provider]:
                raise
            logger.exception("DirectML could not start. Retrying vocal separation on CPU.")
            session = cpu_session()

        # Let this code handle a runtime failure and keep subsequent chunks on CPU.
        session.disable_fallback()
        gpu_active = gpu_provider in session.get_providers()
        logger.info("Vocal separation (%s): %s", model_file, "DirectML" if gpu_active else "CPU")

        def run_model(spectrum):
            nonlocal session, gpu_active
            inputs = {"input": spectrum.cpu().numpy()}
            try:
                return session.run(None, inputs)[0]
            except Exception:
                if not gpu_active:
                    raise
                logger.exception("DirectML inference failed. Continuing vocal separation on CPU.")
            gpu_active = False
            session = cpu_session()
            return session.run(None, inputs)[0]

        mdx.model_run = run_model
        outputs = separator.separate(audio_path, custom_output_names={"Vocals": "vocals"})
        stem = Path(temporary) / "vocals.wav"
        if not outputs or not stem.is_file() or stem.stat().st_size <= 44:
            raise RuntimeError("The vocal separator did not produce a WAV vocal stem")
        destination = output_dir / f"{uuid4()}_vocals.wav"
        stem.replace(destination)
        return str(destination)
